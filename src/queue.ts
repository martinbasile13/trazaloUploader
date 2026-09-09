type Task = () => Promise<void>

// Cola en memoria, sin dependencias externas. Alcanza para un solo proceso
// Node en un VPS chico — si esto algún día corre en más de una instancia,
// hace falta una cola de verdad (Redis) en vez de esto.
const MAX_CONCURRENT = 2
let active = 0
const pending: Task[] = []

function runNext(): void {
  if (active >= MAX_CONCURRENT) return
  const task = pending.shift()
  if (!task) return

  active++
  task()
    .catch((err) => console.error('Error procesando job de la cola:', err))
    .finally(() => {
      active--
      runNext()
    })
}

export function enqueue(task: Task): void {
  pending.push(task)
  runNext()
}
