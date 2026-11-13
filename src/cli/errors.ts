/**
 * R12.13's JSON half, in one place because three callers print it — `main()`'s
 * handler and the two commands whose exit `2` predates the handler. Three
 * spellings of one document is how a caller comes to parse two of them.
 */
export const errorDocument = (message: string): string => JSON.stringify({ error: { message } })

/**
 * The `error:` line is one line by contract, and a zod failure or a spawn error
 * spans several. The JSON document keeps the message whole; this is only what a
 * person scanning stderr sees.
 */
export const oneLine = (message: string): string => message.replace(/\s*\n\s*/g, ' ').trim()

/**
 * A missing dependency for `optimise` and `evals`, whose exit `2` predates the
 * handler and so cannot be a throw: their tests, and `fix`'s precedent, hold the
 * code to a return. Prose stays on stdout without `--json`, as it was; with it
 * the stream carries the document a caller parses, and the `error:` line R12.13
 * asks for goes where `main()` supplied an error stream.
 */
export function refuse(
  deps: { write: (line: string) => void; writeErr?: (line: string) => void },
  message: string,
  json: boolean,
): number {
  if (json) {
    deps.writeErr?.(`error: ${oneLine(message)}`)
    deps.write(errorDocument(message))
  } else {
    deps.write(`${message}\n`)
  }
  return 2
}
