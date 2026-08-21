"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildFieldsetTitle = buildFieldsetTitle;
exports.buildMenuItemTitle = buildMenuItemTitle;
exports.buildSchemaMenuItemTitle = buildSchemaMenuItemTitle;
exports.buildWorkflowTitle = buildWorkflowTitle;
exports.buildPluginTitle = buildPluginTitle;
exports.buildUploadFilterTitle = buildUploadFilterTitle;
exports.buildItemTypeFilterTitle = buildItemTypeFilterTitle;
exports.buildFieldTitle = buildFieldTitle;
exports.buildItemTypeTitle = buildItemTypeTitle;
exports.debugNode = debugNode;
exports.debugCodeAst = debugCodeAst;
exports.parseAstFromCode = parseAstFromCode;
exports.writeCodeFromAst = writeCodeFromAst;
exports.createJsonLiteral = createJsonLiteral;
exports.isBase64Id = isBase64Id;
const tslib_1 = require("tslib");
const ts = tslib_1.__importStar(require("typescript"));
function buildFieldsetTitle(fieldset) {
    return `fieldset "${fieldset.attributes.title}"`;
}
const fieldTypeName = {
    boolean: 'Boolean',
    color: 'Color',
    date: 'Date',
    date_time: 'DateTime',
    file: 'Single asset',
    float: 'Floating-point number',
    gallery: 'Asset gallery',
    image: 'Image',
    integer: 'Integer number',
    json: 'JSON',
    lat_lon: 'Geolocation',
    link: 'Single link',
    links: 'Multiple links',
    rich_text: 'Modular Content (Multiple blocks)',
    single_block: 'Modular Content (Single block)',
    seo: 'SEO meta tags',
    slug: 'Slug',
    string: 'Single-line string',
    structured_text: 'Structured text',
    text: 'Multiple-paragraph text',
    video: 'External video',
};
function buildMenuItemTitle(menuItem) {
    return `menu item "${menuItem.attributes.label}"`;
}
function buildSchemaMenuItemTitle(schemaMenuItem, itemType) {
    const context = schemaMenuItem.attributes.kind === 'item_type' ? 'model' : 'block';
    const name = itemType
        ? `for ${buildItemTypeTitle(itemType)}`
        : `"${schemaMenuItem.attributes.label}"`;
    return `${context} schema menu item ${name}`;
}
function buildWorkflowTitle(workflow) {
    return `workflow "${workflow.attributes.name}"`;
}
function buildPluginTitle(plugin) {
    return `plugin "${plugin.attributes.name}"`;
}
function buildUploadFilterTitle(uploadFilter) {
    return `Media Area filter "${uploadFilter.attributes.name}"`;
}
function buildItemTypeFilterTitle(itemTypeFilter) {
    return `filter "${itemTypeFilter.attributes.name}"`;
}
function buildFieldTitle(field) {
    return `${fieldTypeName[field.attributes.field_type]} field "${field.attributes.label}" (\`${field.attributes.api_key}\`)`;
}
function buildItemTypeTitle(itemType) {
    const itemTypeApiKey = itemType.attributes.api_key;
    const itemTypeName = itemType.attributes.name;
    return `${itemType.attributes.modular_block ? 'block model' : 'model'} "${itemTypeName}" (\`${itemTypeApiKey}\`)`;
}
function debugNode(node, indentation = 0) {
    console.log(' '.repeat(indentation) + ts.SyntaxKind[node.kind]);
    node.forEachChild((child) => {
        debugNode(child, indentation + 1);
    });
}
function debugCodeAst(code) {
    const sourceFile = ts.createSourceFile('someFileName.ts', code, ts.ScriptTarget.ESNext, false, ts.ScriptKind.TS);
    debugNode(sourceFile);
}
function parseAstFromCode(code) {
    const sourceFile = ts.createSourceFile('someFileName.ts', code, ts.ScriptTarget.ESNext, false, ts.ScriptKind.TS);
    return sourceFile;
}
function writeCodeFromAst(nodes) {
    const printer = ts.createPrinter({
        newLine: ts.NewLineKind.LineFeed,
        removeComments: false,
        omitTrailingSemicolon: false,
    });
    const sourceFile = ts.createSourceFile('someFileName.ts', '', ts.ScriptTarget.ESNext, false, ts.ScriptKind.TS);
    return printer.printList(ts.ListFormat.MultiLineBlockStatements, nodes, sourceFile);
}
function createJsonLiteral(element, options) {
    const parentPath = (options === null || options === void 0 ? void 0 : options.parentPath) || [];
    const replace = (options === null || options === void 0 ? void 0 : options.replace) || (() => undefined);
    const replacement = replace(parentPath, element);
    if (replacement !== undefined) {
        return replacement;
    }
    if (Array.isArray(element)) {
        return ts.factory.createArrayLiteralExpression(element.map((child, i) => createJsonLiteral(child, { parentPath: [...parentPath, i], replace })));
    }
    if (element === null || element === undefined) {
        return ts.factory.createNull();
    }
    if (typeof element === 'object') {
        return ts.factory.createObjectLiteralExpression(Object.entries(element).map(([property, child]) => ts.factory.createPropertyAssignment(ts.factory.createStringLiteral(property), createJsonLiteral(child, {
            parentPath: [...parentPath, property],
            replace,
        }))));
    }
    if (typeof element === 'string') {
        return ts.factory.createStringLiteral(element);
    }
    if (typeof element === 'boolean') {
        return element ? ts.factory.createTrue() : ts.factory.createFalse();
    }
    if (typeof element === 'number') {
        // Error: Negative numbers should be created in combination with createPrefixUnaryExpression factory.
        // The method createNumericLiteral only accepts positive numbers
        // or those combined with createPrefixUnaryExpression.
        // Therefore, we need to ensure that the number is not negative.
        if (element < 0) {
            return ts.factory.createPrefixUnaryExpression(ts.SyntaxKind.MinusToken, ts.factory.createNumericLiteral(Math.abs(element)));
        }
        return ts.factory.createNumericLiteral(element);
    }
    throw new Error(`Don't know how to handle ${element}`);
}
function isPositiveInteger(id) {
    const n = Math.floor(Number(id));
    return n !== Number.POSITIVE_INFINITY && String(n) === id && n >= 0;
}
function isBase64Id(id) {
    return id.length === 22 && !isPositiveInteger(id);
}
