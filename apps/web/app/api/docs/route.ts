/**
 * GET /api/docs
 *
 * Serves a Scalar API reference UI that loads the OpenAPI spec from
 * /openapi.yaml. No npm dependency — uses a CDN-hosted script tag.
 */
export async function GET(): Promise<Response> {
  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Open Agents API Reference</title>
    <meta name="description" content="API reference for the Open Agents platform." />
  </head>
  <body>
    <script
      id="api-reference"
      data-url="/openapi.yaml"
      data-configuration='${JSON.stringify({ theme: "default" })}'
    ></script>
    <script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference"></script>
  </body>
</html>`;

  return new Response(html, {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "public, max-age=3600",
    },
  });
}
