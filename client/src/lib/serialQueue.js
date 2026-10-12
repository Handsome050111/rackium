// Runs tasks one after another, in the order they were queued. A design
// screen queues its writes here so a second click made while the first save
// (and its reload) is still in flight waits for it and then uses the
// revision that save produced — instead of racing it with the old revision
// and being refused as stale. A failed task does not stop the ones after it.
export function serialQueue() {
  let tail = Promise.resolve()
  return function run(task) {
    const result = tail.then(task)
    tail = result.catch(() => {})
    return result
  }
}
