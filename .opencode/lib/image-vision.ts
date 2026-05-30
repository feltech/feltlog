/**
 * OpenCode plugin that provides a `describe_image` tool.
 *
 * Reads a local image file, encodes it as a data: URI, and sends it to the configured
 * vision model via the opencode session API.
 *
 * Model is configured via opencode.json plugin options: "vision_model":
 * "nanogpt/xiaomi/mimo-v2.5"
 */
import type { Plugin } from '@opencode-ai/plugin';
import { tool } from '@opencode-ai/plugin';

declare var Bun: typeof import('bun');

const MIME: Record = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
};

export const ImageVisionPlugin: Plugin = async (input: Parameters[0], options?: Record) => {
  const { client } = input;
  const visionModel =
    (options?.vision_model as string) || process.env.OPENCODE_VISION_MODEL || undefined;

  return {
    tool: {
      describe_image: tool({
        description:
          'Describe the contents of an image file. ' +
          'USE THIS TOOL INSTEAD OF `read` FOR .png, .jpg, .jpeg, .gif, .webp, .bmp. ' +
          'The `read` tool cannot process images — you MUST use `describe_image`.',

        args: {
          filePath: tool.schema.string().describe('Path to the image file.'),
          query: tool.schema.string().optional().describe('Specific focus.'),
        },

        async execute(args, ctx) {
          if (!visionModel) {
            throw new Error('No vision model configured in plugin options.');
          }

          const [providerID, ...rest] = visionModel.split('/');
          const modelID = rest.join('/');

          const fp = args.filePath.startsWith('/')
            ? args.filePath
            : `${ctx.directory}/${args.filePath}`;
          // Extract extension using path parsing, handling files like
          // `archive.tar.gz` or paths with no extension correctly.
          const baseName = fp.includes('/') ? fp.split('/').pop()! : fp;
          const ext = baseName.includes('.')
            ? baseName.split('.').pop()?.toLowerCase()
            : undefined;
          const mimeType = MIME[ext || ''] || 'image/png';
          const base64 = Buffer.from(await Bun.file(fp).arrayBuffer()).toString('base64');

          const rawTimeout = options?.vision_timeout_ms;
          const timeoutMs =
            typeof rawTimeout === 'number' && rawTimeout > 0 ? rawTimeout : 120_000;

          const session = await client.session.create({
            body: { title: `Vision: ${args.filePath}` },
          });
          if (session.error) {
            const errStr = JSON.stringify(session.error).slice(0, 300);
            await client.app.log({
              service: 'image-vision',
              level: 'error',
              message: 'Session creation failed',
              extra: { filePath: args.filePath, error: errStr },
            });
            throw new Error(`Session create failed: ${errStr}`);
          }

          await client.app.log({
            service: 'image-vision',
            level: 'info',
            message: 'Starting vision request',
            extra: { filePath: args.filePath, model: visionModel, mimeType },
          });

          let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
          const timeoutPromise = new Promise<never>((_, reject) => {
            timeoutHandle = setTimeout(() => {
              reject(new Error(`Vision model timed out after ${timeoutMs / 1000}s`));
            }, timeoutMs);
          });

          try {
            const promptPromise = client.session.prompt({
              path: { id: session.data.id },
              body: {
                model: { providerID, modelID },
                parts: [
                  {
                    type: 'text',
                    text:
                      args.query ||
                      'Describe this image in detail. Focus on UI elements, ' +
                        'visible text, layout, colors, and any notable features. ' +
                        'Be precise and factual.',
                  },
                  {
                    type: 'file',
                    mime: mimeType,
                    url: `data:${mimeType};base64,${base64}`,
                  },
                ],
              },
            });
            // Swallow eventual rejection if the timeout wins the race,
            // preventing an unhandled rejection crash.
            promptPromise.catch(() => {});
            const result = await Promise.race([promptPromise, timeoutPromise]);
            clearTimeout(timeoutHandle);

            if (result.error) {
              // Strip base64 data from the error to keep it readable.
              // Match a JSON string value containing a data: URI with at
              // least 20 characters after the 'data:' prefix.
              const errStr = JSON.stringify(result.error).replace(
                /"data:[^"]{20,}"/g,
                '"data:<base64 omitted>"',
              );
              throw new Error(`Vision model error: ${errStr.slice(0, 500)}`);
            }

            await client.app.log({
              service: 'image-vision',
              level: 'info',
              message: 'Vision request completed',
              extra: { filePath: args.filePath },
            });

            return (
              result.data.parts
                ?.filter((p: { type: string }) => p.type === 'text')
                .map((p: { text: string }) => p.text)
                .join('\n') || 'No description returned'
            );
          } catch (error) {
            clearTimeout(timeoutHandle);
            const errorMessage = error instanceof Error ? error.message : String(error);
            await client.app.log({
              service: 'image-vision',
              level: 'error',
              message: 'Vision request failed',
              extra: { filePath: args.filePath, error: errorMessage },
            });
            await client.session.abort({ path: { id: session.data.id } }).catch(() => {});
            throw error;
          } finally {
            await client.session.delete({ path: { id: session.data.id } }).catch(() => {});
          }
        },
      }),
    },
  };
};
