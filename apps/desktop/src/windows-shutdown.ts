/** Bridge owned parent IPC to the CLI's verified graceful signal handlers. */
const stop = () => {
  process.emit('SIGTERM')
}
const message = (value: unknown) => {
  if (value && typeof value === 'object' && 'type' in value && value.type === 'stop') stop()
}
await new Promise<void>(resolve => {
  const disconnected = () => process.exit(1)
  const start = (value: unknown) => {
    if (value && typeof value === 'object' && 'type' in value && value.type === 'start') {
      process.off('message', start)
      process.off('disconnect', disconnected)
      resolve()
    }
  }
  process.on('message', start)
  process.once('disconnect', disconnected)
})
process.on('message', message)
process.once('disconnect', stop)
process.channel?.unref()
process.once('beforeExit', () => {
  process.off('message', message)
  process.off('disconnect', stop)
  if (process.connected) process.disconnect()
})
