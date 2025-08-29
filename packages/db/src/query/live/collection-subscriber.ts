import { MultiSet } from "@tanstack/db-ivm"
import { createFilterFunctionFromExpression } from "../../change-events.js"
import { convertToBasicExpression } from "../compiler/expressions.js"
import type { FullSyncState } from "./types.js"
import type { MultiSetArray, RootStreamBuilder } from "@tanstack/db-ivm"
import type { Collection } from "../../collection.js"
import type { ChangeMessage, SyncConfig } from "../../types.js"
import type { Context, GetResult } from "../builder/types.js"
import type { BasicExpression } from "../ir.js"
import type { CollectionConfigBuilder } from "./collection-config-builder.js"

export class CollectionSubscriber<
  TContext extends Context,
  TResult extends object = GetResult<TContext>,
> {
  // Keep track of the keys we've sent (needed for join and orderBy optimizations)
  private sentKeys = new Set<string | number>()

  // Keep track of the biggest value we've sent so far (needed for orderBy optimization)
  private biggest: any = undefined

  constructor(
    private collectionId: string,
    private collection: Collection,
    private config: Parameters<SyncConfig<TResult>[`sync`]>[0],
    private syncState: FullSyncState,
    private collectionConfigBuilder: CollectionConfigBuilder<TContext, TResult>
  ) {}

  subscribe() {
    const collectionAlias = findCollectionAlias(
      this.collectionId,
      this.collectionConfigBuilder.query
    )
    const whereClause = this.getWhereClauseFromAlias(collectionAlias)

    if (whereClause) {
      // Convert WHERE clause to BasicExpression format for collection subscription
      const whereExpression = convertToBasicExpression(
        whereClause,
        collectionAlias!
      )

      if (whereExpression) {
        // Use index optimization for this collection
        this.subscribeToChanges(whereExpression)
      } else {
        // This should not happen - if we have a whereClause but can't create whereExpression,
        // it indicates a bug in our optimization logic
        throw new Error(
          `Failed to convert WHERE clause to collection filter for collection '${this.collectionId}'. ` +
            `This indicates a bug in the query optimization logic.`
        )
      }
    } else {
      // No WHERE clause for this collection, use regular subscription
      this.subscribeToChanges()
    }
  }

  private subscribeToChanges(whereExpression?: BasicExpression<boolean>) {
    let unsubscribe: () => void
    if (this.collectionConfigBuilder.lazyCollections.has(this.collectionId)) {
      unsubscribe = this.subscribeToMatchingChanges(whereExpression)
    } else if (
      Object.hasOwn(
        this.collectionConfigBuilder.optimizableOrderByCollections,
        this.collectionId
      )
    ) {
      unsubscribe = this.subscribeToOrderedChanges(whereExpression)
    } else {
      unsubscribe = this.subscribeToAllChanges(whereExpression)
    }
    this.syncState.unsubscribeCallbacks.add(unsubscribe)
  }

  private sendChangesToPipeline(
    changes: Iterable<ChangeMessage<any, string | number>>,
    callback?: () => boolean
  ) {
    const input = this.syncState.inputs[this.collectionId]!
    const sentChanges = sendChangesToInput(
      input,
      changes,
      this.collection.config.getKey
    )

    // Do not provide the callback that loads more data
    // if there's no more data to load
    // otherwise we end up in an infinite loop trying to load more data
    const dataLoader = sentChanges > 0 ? callback : undefined

    // We need to call `maybeRunGraph` even if there's no data to load
    // because we need to mark the collection as ready if it's not already
    // and that's only done in `maybeRunGraph`
    this.collectionConfigBuilder.maybeRunGraph(
      this.config,
      this.syncState,
      dataLoader
    )
  }

  // Wraps the sendChangesToPipeline function
  // in order to turn `update`s into `insert`s
  // for keys that have not been sent to the pipeline yet
  // and filter out deletes for keys that have not been sent
  private sendVisibleChangesToPipeline = (
    changes: Array<ChangeMessage<any, string | number>>,
    loadedInitialState: boolean
  ) => {
    if (loadedInitialState) {
      // There was no index for the join key
      // so we loaded the initial state
      // so we can safely assume that the pipeline has seen all keys
      return this.sendChangesToPipeline(changes)
    }

    const newChanges = []
    for (const change of changes) {
      let newChange = change
      if (!this.sentKeys.has(change.key)) {
        if (change.type === `update`) {
          newChange = { ...change, type: `insert` }
        } else if (change.type === `delete`) {
          // filter out deletes for keys that have not been sent
          continue
        }
        this.sentKeys.add(change.key)
      }
      newChanges.push(newChange)
    }

    return this.sendChangesToPipeline(newChanges)
  }

  private loadKeys(
    keys: Iterable<string | number>,
    filterFn: (item: object) => boolean
  ) {
    for (const key of keys) {
      // Only load the key once
      if (this.sentKeys.has(key)) continue

      const value = this.collection.get(key)
      if (value !== undefined && filterFn(value)) {
        this.sentKeys.add(key)
        this.sendChangesToPipeline([{ type: `insert`, key, value }])
      }
    }
  }

  private subscribeToAllChanges(
    whereExpression: BasicExpression<boolean> | undefined
  ) {
    const sendChangesToPipeline = this.sendChangesToPipeline.bind(this)
    const unsubscribe = this.collection.subscribeChanges(
      sendChangesToPipeline,
      {
        includeInitialState: true,
        ...(whereExpression ? { whereExpression } : undefined),
      }
    )
    return unsubscribe
  }

  private subscribeToMatchingChanges(
    whereExpression: BasicExpression<boolean> | undefined
  ) {
    // Flag to indicate we have send to whole initial state of the collection
    // to the pipeline, this is set when there are no indexes that can be used
    // to filter the changes and so the whole state was requested from the collection
    let loadedInitialState = false

    // Flag to indicate that we have started sending changes to the pipeline.
    // This is set to true by either the first call to `loadKeys` or when the
    // query requests the whole initial state in `loadInitialState`.
    // Until that point we filter out all changes from subscription to the collection.
    let sendChanges = false

    const sendVisibleChanges = (
      changes: Array<ChangeMessage<any, string | number>>
    ) => {
      // We filter out changes when sendChanges is false to ensure that we don't send
      // any changes from the live subscription until the join operator requests either
      // the initial state or its first key. This is needed otherwise it could receive
      // changes which are then later subsumed by the initial state (and that would
      // lead to weird bugs due to the data being received twice).
      this.sendVisibleChangesToPipeline(
        sendChanges ? changes : [],
        loadedInitialState
      )
    }

    const unsubscribe = this.collection.subscribeChanges(sendVisibleChanges, {
      whereExpression,
    })

    // Create a function that loads keys from the collection
    // into the query pipeline on demand
    const filterFn = whereExpression
      ? createFilterFunctionFromExpression(whereExpression)
      : () => true
    const loadKs = (keys: Set<string | number>) => {
      sendChanges = true
      return this.loadKeys(keys, filterFn)
    }

    // Store the functions to load keys and load initial state in the `lazyCollectionsCallbacks` map
    // This is used by the join operator to dynamically load matching keys from the lazy collection
    // or to get the full initial state of the collection if there's no index for the join key
    this.collectionConfigBuilder.lazyCollectionsCallbacks[this.collectionId] = {
      loadKeys: loadKs,
      loadInitialState: () => {
        // Make sure we only load the initial state once
        if (loadedInitialState) return
        loadedInitialState = true
        sendChanges = true

        const changes = this.collection.currentStateAsChanges({
          whereExpression,
        })
        this.sendChangesToPipeline(changes)
      },
    }
    return unsubscribe
  }

  private subscribeToOrderedChanges(
    whereExpression: BasicExpression<boolean> | undefined
  ) {
    const { offset, limit, comparator, dataNeeded } =
      this.collectionConfigBuilder.optimizableOrderByCollections[
        this.collectionId
      ]!

    // Load the first `offset + limit` values from the index
    // i.e. the K items from the collection that fall into the requested range: [offset, offset + limit[
    this.loadNextItems(offset + limit)

    const sendChangesInRange = (
      changes: Iterable<ChangeMessage<any, string | number>>
    ) => {
      // Split live updates into a delete of the old value and an insert of the new value
      // and filter out changes that are bigger than the biggest value we've sent so far
      // because they can't affect the topK
      const splittedChanges = splitUpdates(changes)
      let filteredChanges = splittedChanges
      if (dataNeeded!() === 0) {
        // If the topK is full [..., maxSentValue] then we do not need to send changes > maxSentValue
        // because they can never make it into the topK.
        // However, if the topK isn't full yet, we need to also send changes > maxSentValue
        // because they will make it into the topK
        filteredChanges = filterChangesSmallerOrEqualToMax(
          splittedChanges,
          comparator,
          this.biggest
        )
      }
      this.sendChangesToPipeline(
        filteredChanges,
        this.loadMoreIfNeeded.bind(this)
      )
    }

    // Subscribe to changes and only send changes that are smaller than the biggest value we've sent so far
    // values that are bigger don't need to be sent because they can't affect the topK
    const unsubscribe = this.collection.subscribeChanges(sendChangesInRange, {
      whereExpression,
    })

    return unsubscribe
  }

  // This function is called by maybeRunGraph
  // after each iteration of the query pipeline
  // to ensure that the orderBy operator has enough data to work with
  loadMoreIfNeeded() {
    const orderByInfo =
      this.collectionConfigBuilder.optimizableOrderByCollections[
        this.collectionId
      ]

    if (!orderByInfo) {
      // This query has no orderBy operator
      // so there's no data to load, just return true
      return true
    }

    const { dataNeeded } = orderByInfo

    if (!dataNeeded) {
      // This should never happen because the topK operator should always set the size callback
      // which in turn should lead to the orderBy operator setting the dataNeeded callback
      throw new Error(
        `Missing dataNeeded callback for collection ${this.collectionId}`
      )
    }

    // `dataNeeded` probes the orderBy operator to see if it needs more data
    // if it needs more data, it returns the number of items it needs
    const n = dataNeeded()
    let noMoreNextItems = false
    if (n > 0) {
      const loadedItems = this.loadNextItems(n)
      noMoreNextItems = loadedItems === 0
    }

    // Indicate that we're done loading data if we didn't need to load more data
    // or there's no more data to load
    return n === 0 || noMoreNextItems
  }

  private sendChangesToPipelineWithTracking(
    changes: Iterable<ChangeMessage<any, string | number>>
  ) {
    const { comparator } =
      this.collectionConfigBuilder.optimizableOrderByCollections[
        this.collectionId
      ]!
    const trackedChanges = this.trackSentValues(changes, comparator)
    this.sendChangesToPipeline(trackedChanges, this.loadMoreIfNeeded.bind(this))
  }

  // Loads the next `n` items from the collection
  // starting from the biggest item it has sent
  private loadNextItems(n: number) {
    const { valueExtractorForRawRow, index } =
      this.collectionConfigBuilder.optimizableOrderByCollections[
        this.collectionId
      ]!
    const biggestSentRow = this.biggest
    const biggestSentValue = biggestSentRow
      ? valueExtractorForRawRow(biggestSentRow)
      : biggestSentRow
    // Take the `n` items after the biggest sent value
    const nextOrderedKeys = index.take(n, biggestSentValue)
    const nextInserts: Array<ChangeMessage<any, string | number>> =
      nextOrderedKeys.map((key) => {
        return { type: `insert`, key, value: this.collection.get(key) }
      })
    this.sendChangesToPipelineWithTracking(nextInserts)
    return nextInserts.length
  }

  private getWhereClauseFromAlias(
    collectionAlias: string | undefined
  ): BasicExpression<boolean> | undefined {
    const collectionWhereClausesCache =
      this.collectionConfigBuilder.collectionWhereClausesCache
    if (collectionAlias && collectionWhereClausesCache) {
      return collectionWhereClausesCache.get(collectionAlias)
    }
    return undefined
  }

  private *trackSentValues(
    changes: Iterable<ChangeMessage<any, string | number>>,
    comparator: (a: any, b: any) => number
  ) {
    for (const change of changes) {
      this.sentKeys.add(change.key)

      if (!this.biggest) {
        this.biggest = change.value
      } else if (comparator(this.biggest, change.value) < 0) {
        this.biggest = change.value
      }

      yield change
    }
  }
}

/**
 * Finds the alias for a collection ID in the query
 */
function findCollectionAlias(
  collectionId: string,
  query: any
): string | undefined {
  // Check FROM clause
  if (
    query.from?.type === `collectionRef` &&
    query.from.collection?.id === collectionId
  ) {
    return query.from.alias
  }

  // Check JOIN clauses
  if (query.join) {
    for (const joinClause of query.join) {
      if (
        joinClause.from?.type === `collectionRef` &&
        joinClause.from.collection?.id === collectionId
      ) {
        return joinClause.from.alias
      }
    }
  }

  return undefined
}

/**
 * Helper function to send changes to a D2 input stream
 */
function sendChangesToInput(
  input: RootStreamBuilder<unknown>,
  changes: Iterable<ChangeMessage>,
  getKey: (item: ChangeMessage[`value`]) => any
): number {
  const multiSetArray: MultiSetArray<unknown> = []
  for (const change of changes) {
    const key = getKey(change.value)
    if (change.type === `insert`) {
      multiSetArray.push([[key, change.value], 1])
    } else if (change.type === `update`) {
      multiSetArray.push([[key, change.previousValue], -1])
      multiSetArray.push([[key, change.value], 1])
    } else {
      // change.type === `delete`
      multiSetArray.push([[key, change.value], -1])
    }
  }
  input.sendData(new MultiSet(multiSetArray))
  return multiSetArray.length
}

/** Splits updates into a delete of the old value and an insert of the new value */
function* splitUpdates<
  T extends object = Record<string, unknown>,
  TKey extends string | number = string | number,
>(
  changes: Iterable<ChangeMessage<T, TKey>>
): Generator<ChangeMessage<T, TKey>> {
  for (const change of changes) {
    if (change.type === `update`) {
      yield { type: `delete`, key: change.key, value: change.previousValue! }
      yield { type: `insert`, key: change.key, value: change.value }
    } else {
      yield change
    }
  }
}

function* filterChanges<
  T extends object = Record<string, unknown>,
  TKey extends string | number = string | number,
>(
  changes: Iterable<ChangeMessage<T, TKey>>,
  f: (change: ChangeMessage<T, TKey>) => boolean
): Generator<ChangeMessage<T, TKey>> {
  for (const change of changes) {
    if (f(change)) {
      yield change
    }
  }
}

/**
 * Filters changes to only include those that are smaller than the provided max value
 * @param changes - Iterable of changes to filter
 * @param comparator - Comparator function to use for filtering
 * @param maxValue - Range to filter changes within (range boundaries are exclusive)
 * @returns Iterable of changes that fall within the range
 */
function* filterChangesSmallerOrEqualToMax<
  T extends object = Record<string, unknown>,
  TKey extends string | number = string | number,
>(
  changes: Iterable<ChangeMessage<T, TKey>>,
  comparator: (a: any, b: any) => number,
  maxValue: any
): Generator<ChangeMessage<T, TKey>> {
  yield* filterChanges(changes, (change) => {
    return !maxValue || comparator(change.value, maxValue) <= 0
  })
}
