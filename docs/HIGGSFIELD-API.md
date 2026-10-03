# Higgsfield in Design

Design offers two Higgsfield connections: its USD API and its account connector. Both use HTTP directly. Neither uses the Higgsfield CLI or borrows a login from another application.

## Nano Banana 2 through your Higgsfield account

Choose **Higgsfield → Account** in the composer, select **Nano Banana 2**, then **Connect Higgsfield**. The **API / Account** switch keeps the two model catalogs and billing methods separate; new sessions start with API until you choose otherwise. Your connection choice is remembered on this browser. Complete Higgsfield's sign-in and consent once, and return to Design. The OS registers its own local OAuth client, uses PKCE and single-use state, and stores the resulting grant privately on this Mac. An existing ChatGPT or Codex connector grant is not copied into the OS.

The composer uses one compact **Connect Higgsfield** action in the Generate position until sign-in completes. Full account details and disconnect remain in Connections. Pending sign-in and error feedback do not add a permanent panel above the prompt.

After connection, model controls and credit quotes come from Higgsfield's MCP server. The button displays **Generate · [price] credits** and explicitly chooses credit payment. One image is submitted per click and saved to the Design library. This initial account integration supports text-to-image; reference images are rejected visibly before submission. The direct API connection continues to support its existing reference upload flow.

Account authorization lives in `~/.claude-os/design/higgsfield-account.json` with owner-only permissions. The adjacent `.requests.json` journal retains submission attempts and accepted job IDs. Generation submissions are never retried automatically, and stopping the local wait does not establish provider cancellation or a refund. Check the existing job in your Higgsfield account before retrying an uncertain request. Disconnecting the OS removes its local grant.

This package contains no configured Higgsfield account or API key. Verify authorization, model availability and the displayed price with your own account before generating.

## Connect the USD API

1. Open **Design**, choose **Higgsfield** in the named provider selector, and select **API**. Open the provider button for connection settings.
2. Create an API key in the [Higgsfield API console](https://console.higgsfield.ai).
3. Enter the key ID and secret as `KEY_ID:KEY_SECRET` in the private API-key field, then choose **Verify and connect**.

The local server verifies the credential before saving it. The check requests an upload grant; it does not generate an image or video. Saved keys stay in `~/.claude-os/config.json`, outside the project and its downloadable source package. The browser receives connection status, not a stored key.

You can also configure the local server with `HF_CREDENTIALS` or `HF_KEY` containing the same combined value, or with `HF_API_KEY_ID` and `HF_API_KEY_SECRET`. Restart the server after changing environment variables. Never add keys to Git or a shared archive.

## Models and billing

Design reads model names and input controls from the official Higgsfield API console. API model IDs differ from the CLI's model names; select a model again if an older saved choice is unavailable.

Marketing Studio workflows are excluded from the standard model picker. Nano Banana 2 is available in the Higgsfield account connector, but a direct API-key endpoint is not verified: both the public API catalog and pricing search returned no entry on 17 September 2026. Connector availability does not establish API-key access. The Account model picker routes Nano Banana 2 through the account connection above and does not switch to another provider. It is excluded from the API model list until a direct endpoint is verified. Connection status and billing units appear in the picker. The menu uses viewport-aware positioning and an independently scrolling model list so its heading and search stay visible below the OS header.

The API uses its own dollar balance. Website subscription credits are separate. Design loads published USD prices from Higgsfield's public catalog and pricing service, matches them by exact endpoint slug, and refreshes the cached catalog after one hour. All 22 models in the loaded catalog had published prices during validation on 17 September 2026.

The model picker shows starting rates with their billing units. The composer shows **This run** when published conditions match the selected settings and an estimate can be calculated from the output count or duration. Otherwise it shows **Model rate**, with the published starting price and a link to the provider's pricing. Unpublished setting combinations are not extrapolated. For example, Soul 2 at 4:3 lists $0.0032 per 720p image and $0.0057 per 1080p image. Rates can change, and the provider's final bill remains authoritative. Token-priced models show the token rate instead of an invented flat image price. Balance remains linked to the API console where no documented read endpoint is available; an unknown balance is not shown as zero.

Generation is asynchronous. Design uploads any selected reference images, submits the request, checks its status, and saves the output to the existing Design library. Stopping a request attempts cancellation where the provider supports it. If a request times out or its outcome is uncertain, check the API console before submitting it again.

Accepted request IDs are saved privately in `~/.claude-os/design/higgsfield-requests.json` before polling. The adapter accepts the exact request paths on both documented production hosts, `api.higgsfield.ai` and the official V2 SDK's `platform.higgsfield.ai`, while rejecting unrelated hosts. It does not automatically repeat generation submissions. Requests needing attention remain visible in Design with their IDs and a console link. A local failure does not delete the provider request or establish a refund.

This package contains no configured Higgsfield account or API key. Verify authorization, model availability and the displayed price with your own account before generating.

Official reference: [account connectors](https://higgsfield.ai/creator-hub/help-center/integrations/how-do-i-connect-higgsfield-to-ai-agent), [API authentication](https://docs.higgsfield.ai/docs/authentication), [requests](https://docs.higgsfield.ai/docs/concepts/requests), and [file uploads](https://docs.higgsfield.ai/docs/concepts/file-uploads).
