"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildCommentNode = buildCommentNode;
const tslib_1 = require("tslib");
const ts = tslib_1.__importStar(require("typescript"));
function buildCommentNode(comment) {
    return ts.factory.createCallExpression(ts.factory.createIdentifier('console.log'), undefined, [ts.factory.createStringLiteral(comment.message)]);
}
