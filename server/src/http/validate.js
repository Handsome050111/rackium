// Parses request parts with a Zod schema. Results land on req.input so the
// handler never reads raw, unvalidated req.body/query/params.
export function validate({ body, query, params } = {}) {
  return (req, res, next) => {
    try {
      req.input = {
        body: body ? body.parse(req.body ?? {}) : undefined,
        query: query ? query.parse(req.query ?? {}) : undefined,
        params: params ? params.parse(req.params ?? {}) : undefined,
      }
      next()
    } catch (err) {
      next(err)
    }
  }
}
