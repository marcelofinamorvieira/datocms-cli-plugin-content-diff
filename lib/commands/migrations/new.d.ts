import { CmaClientCommand, oclif } from '@datocms/cli-utils';
export default class Command extends CmaClientCommand {
    static description: string;
    static flags: {
        ts: oclif.Interfaces.BooleanFlag<boolean>;
        js: oclif.Interfaces.BooleanFlag<boolean>;
        template: oclif.Interfaces.OptionFlag<string | undefined, oclif.Interfaces.CustomOptions>;
        autogenerate: oclif.Interfaces.OptionFlag<string | undefined, oclif.Interfaces.CustomOptions>;
        schema: oclif.Interfaces.OptionFlag<string | undefined, oclif.Interfaces.CustomOptions>;
    };
    static args: {
        NAME: oclif.Interfaces.Arg<string, Record<string, unknown>>;
    };
    run(): Promise<string>;
    migrationScriptContent(template: string | undefined, format: 'js' | 'ts', migrationFilePath: string, rawAutoGenerate: string | undefined, schemaFilter: string | undefined): Promise<string>;
    private generateSchemaTypes;
    private addSchemaTypesToMigration;
}
