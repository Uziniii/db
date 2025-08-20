# @tanstack/svelte-db

## 0.1.5

### Patch Changes

- Updated dependencies [[`9a5a20c`](https://github.com/TanStack/db/commit/9a5a20c21fbf8286ab90e1db6d6f3315f8344a4e)]:
  - @tanstack/db@0.1.5

## 0.1.4

### Patch Changes

- Ensure that the ready status is correctly returned from a live query ([#390](https://github.com/TanStack/db/pull/390))

- Updated dependencies [[`c90b4d8`](https://github.com/TanStack/db/commit/c90b4d85822f94f7fe72286d5c7ee07b087d0e20), [`6c1c19c`](https://github.com/TanStack/db/commit/6c1c19cedbc1d9d98396948e8e43fa0515bb8919), [`69a6d2d`](https://github.com/TanStack/db/commit/69a6d2d94c7a5510568c8b652356c62bd2b3cc76), [`6250a92`](https://github.com/TanStack/db/commit/6250a92c8045ef2fd69c107a94e05179471681d7), [`68538b4`](https://github.com/TanStack/db/commit/68538b4c446abeb992e24964f811c8900749f141)]:
  - @tanstack/db@0.1.4

## 0.1.3

### Patch Changes

- Updated dependencies [[`0cb7699`](https://github.com/TanStack/db/commit/0cb76999e5d6df5916694a5afeb31b928eab68e4)]:
  - @tanstack/db@0.1.3

## 0.1.2

### Patch Changes

- Updated dependencies [[`bb5d50e`](https://github.com/TanStack/db/commit/bb5d50e255d9114ef32b8f52eef6b15399255327), [`97b595e`](https://github.com/TanStack/db/commit/97b595e9617b1abb05c14489e3d608b314da08e8)]:
  - @tanstack/db@0.1.2

## 0.1.1

### Patch Changes

- Updated dependencies [[`bc2f204`](https://github.com/TanStack/db/commit/bc2f204b8cb8a4870ade00757d10f846524e2090), [`bda3f24`](https://github.com/TanStack/db/commit/bda3f24cc41504f60be0c5e071698b7735f75e28)]:
  - @tanstack/db@0.1.1

## 0.1.0

### Minor Changes

- 0.1 release - first beta 🎉 ([#332](https://github.com/TanStack/db/pull/332))

### Patch Changes

- We have moved development of the differential dataflow implementation from @electric-sql/d2mini to a new @tanstack/db-ivm package inside the tanstack db monorepo to make development simpler. ([#330](https://github.com/TanStack/db/pull/330))

- Updated dependencies [[`7d2f4be`](https://github.com/TanStack/db/commit/7d2f4be95c43aad29fb61e80e5a04c58c859322b), [`f0eda36`](https://github.com/TanStack/db/commit/f0eda36cb36350399bc8835686a6c4b6ad297e45)]:
  - @tanstack/db@0.1.0

## 0.0.3

### Patch Changes

- Updated dependencies [[`6e8d7f6`](https://github.com/TanStack/db/commit/6e8d7f660050118e050d575913733e469e3daa8c)]:
  - @tanstack/db@0.0.33

## 0.0.2

### Patch Changes

- Updated dependencies [[`e04bd12`](https://github.com/TanStack/db/commit/e04bd1252f612d4638104368d17cb644cc85295b)]:
  - @tanstack/db@0.0.32

## 0.0.1

### Patch Changes

- Add Svelte support ([#91](https://github.com/TanStack/db/pull/91))

  Usage example:

  ```svelte
  <script lang="ts">
  import { useLiveQuery } from "@tanstack/svelte-db"
  import { eq } from "@tanstack/db"
  import { todoCollection } from "$lib/collections"

  const todosQuery = useLiveQuery((query) =>
    query
      .from({ todos: todoCollection })
      .where(({ todos }) => eq(todos.completed, false))
  )
  </script>


  <List items={todosQuery.data} />
  ```

- Updated dependencies [[`3e9a36d`](https://github.com/TanStack/db/commit/3e9a36d2600c4f700ca7bc4f720c189a5a29387a)]:
  - @tanstack/db@0.0.31
