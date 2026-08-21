export declare const RUNTIME_VERSION: "16";
export declare const CONTENT_DIFF_MIGRATION_PROTOCOL_VERSION: 1;
export declare const CONTENT_DIFF_MIGRATION_BINDING_VERSION: 1;
export type RuntimeFormat = 'js' | 'ts';
/**
 * Render the immutable runtime copied next to generated content migrations.
 *
 * The emitted file deliberately carries its own canonicalizers and executor:
 * generated migrations must keep working after this plugin is upgraded or
 * removed. Its only non-built-in dependency is the CMA client handed to the
 * migration entrypoint by `datocms migrations:run`.
 */
export declare function renderRuntime(format: RuntimeFormat): string;
/** Render the small migration file discovered by `migrations:run`. */
export declare function renderEntrypoint(format: RuntimeFormat, manifestBasename: string, manifestSha256: string, targetSiteId: string): string;
