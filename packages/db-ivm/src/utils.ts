/**
 * Simple assertion function for runtime checks.
 * Throws an error if the condition is false.
 */
export function assert(
  condition: unknown,
  message?: string
): asserts condition {
  if (!condition) {
    throw new Error(message || `Assertion failed`)
  }
}

/**
 * A map that returns a default value for keys that are not present.
 */
export class DefaultMap<K, V> extends Map<K, V> {
  constructor(
    private defaultValue: () => V,
    entries?: Iterable<[K, V]>
  ) {
    super(entries)
  }

  get(key: K): V {
    if (!this.has(key)) {
      // this.set(key, this.defaultValue())
      return this.defaultValue()
    }
    return super.get(key)!
  }

  /**
   * Update the value for a key using a function.
   */
  update(key: K, updater: (value: V) => V): V {
    const value = this.get(key)
    const newValue = updater(value)
    this.set(key, newValue)
    return newValue
  }
}

// JS engines have various limits on how many args can be passed to a function
// with a spread operator, so we need to split the operation into chunks
// 32767 is the max for Chrome 14, all others are higher
// TODO: investigate the performance of this and other approaches
const chunkSize = 30000
export function chunkedArrayPush(array: Array<unknown>, other: Array<unknown>) {
  if (other.length <= chunkSize) {
    array.push(...other)
  } else {
    for (let i = 0; i < other.length; i += chunkSize) {
      const chunk = other.slice(i, i + chunkSize)
      array.push(...chunk)
    }
  }
}

export function binarySearch<T>(
  array: Array<T>,
  value: T,
  comparator: (a: T, b: T) => number
): number {
  let low = 0
  let high = array.length
  while (low < high) {
    const mid = Math.floor((low + high) / 2)
    const comparison = comparator(array[mid]!, value)
    if (comparison < 0) {
      low = mid + 1
    } else if (comparison > 0) {
      high = mid
    } else {
      return mid
    }
  }
  return low
}

/**
 * Utility for generating unique IDs for objects and values.
 * Uses WeakMap for object reference tracking and consistent hashing for primitives.
 */
export class ObjectIdGenerator {
  private objectIds = new WeakMap<object, number>()
  private nextId = 0

  /**
   * Get a unique identifier for any value.
   * - Objects: Uses WeakMap for reference-based identity
   * - Primitives: Uses consistent string-based hashing
   */
  getId(value: any): number {
    // For primitives, use a simple hash of their string representation
    if (typeof value !== `object` || value === null) {
      const str = String(value)
      let hashValue = 0
      for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i)
        hashValue = (hashValue << 5) - hashValue + char
        hashValue = hashValue & hashValue // Convert to 32-bit integer
      }
      return hashValue
    }

    // For objects, use WeakMap to assign unique IDs
    if (!this.objectIds.has(value)) {
      this.objectIds.set(value, this.nextId++)
    }
    return this.objectIds.get(value)!
  }

  /**
   * Get a string representation of the ID for use in composite keys.
   */
  getStringId(value: any): string {
    if (value === null) return `null`
    if (value === undefined) return `undefined`
    if (typeof value !== `object`) return `str_${String(value)}`

    return `obj_${this.getId(value)}`
  }
}

/**
 * Global instance for cases where a shared object ID space is needed.
 */
export const globalObjectIdGenerator = new ObjectIdGenerator()

export function* concatIterable<T>(
  ...iterables: Array<Iterable<T>>
): Iterable<T> {
  for (const iterable of iterables) {
    yield* iterable
  }
}

export function* mapIterable<T, U>(
  it: Iterable<T>,
  fn: (t: T) => U
): Iterable<U> {
  for (const t of it) {
    yield fn(t)
  }
}
