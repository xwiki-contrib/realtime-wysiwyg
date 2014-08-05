/*
 * Copyright 2014 XWiki SAS
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 */
define(function () {

    var module = { exports: {} };
    var PARANOIA = true;

    var debug = function (x) { };
    debug = function (x) { console.log(x); };

    var getNextSiblingDeep = function (node, parent)
    {
        if (node.firstChild) { return node.firstChild; }
        do {
            if (node.nextSibling) { return node.nextSibling; }
            node = node.parentNode;
        } while (node && node !== parent);
    };

    var getOuterHTML = function (node)
    {
        var html = node.outerHTML;
        if (html) { return html; }
        if (node.parentNode && node.parentNode.childNodes.length === 1) {
            return node.parentNode.innerHTML;
        }
        var div = document.createElement('div');
        div.appendChild(node.cloneNode(true));
        return div.innerHTML;
    };

    var nodeFromHTML = function (html)
    {
        var e = document.createElement('div');
        e.innerHTML = html;
        return e.childNodes[0];
    };

    var indexOfSkipQuoted = function (haystack, needle)
    {
        var os = 0;
        for (;;) {
            var dqi = haystack.indexOf('"');
            var sqi = haystack.indexOf("'");
            var needlei = haystack.indexOf(needle);
            if (needlei === -1) { return -1; }
            if (dqi > -1 && dqi < sqi && dqi < needlei) {
                dqi = haystack.indexOf('"', dqi+1);
                if (dqi === -1) { throw new Error(); }
                haystack = haystack.substring(dqi);
                os += dqi;
            } else if (sqi > -1 && sqi < needlei) {
                sqi = haystack.indexOf('"', sqi+1);
                if (sqi === -1) { throw new Error(); }
                haystack = haystack.substring(sqi);
                os += sqi;
            } else {
                return needlei + os;
            }
        }
    };

    var tagWidth = function (nodeOuterHTML)
    {
        if (nodeOuterHTML.length < 2 || nodeOuterHTML[1] === '!' || nodeOuterHTML[0] !== '<') {
            return 0;
        }
        return indexOfSkipQuoted(nodeOuterHTML, '>') + 1;
    };

    var getInnerHTML = function (node)
    {
        var html = node.innerHTML;
        if (html) { return html; }
        var outerHTML = getOuterHTML(node);
        var tw = tagWidth(outerHTML);
        if (!tw) { return outerHTML; }
        return outerHTML.substring(tw, outerHTML.lastIndexOf('</'));
    };

    var uniqueId = function () { return 'uid-'+(''+Math.random()).slice(2); };

    var offsetOfNodeOuterHTML = function (docText, node, dom, ifrWindow)
    {
        if (PARANOIA && getInnerHTML(dom) !== docText) { throw new Error(); }
        if (PARANOIA && !node) { throw new Error(); }

        // can't get the index of the outerHTML of the dom in a string with only the innerHTML.
        if (node === dom) { throw new Error(); }

        var content = getOuterHTML(node);
        var idx = docText.lastIndexOf(content);
        if (idx === -1) { throw new Error(); }

        if (idx !== docText.indexOf(content)) {
            var idTag = uniqueId();
            var span = ifrWindow.document.createElement('span');
            span.setAttribute('id', idTag);
            var spanHTML = '<span id="'+idTag+'"></span>';
            if (PARANOIA && spanHTML !== span.outerHTML) { throw new Error(); }

            node.parentNode.insertBefore(span, node);
            var newDocText = getInnerHTML(dom);
            idx = newDocText.lastIndexOf(spanHTML);
            if (idx === -1 || idx !== newDocText.indexOf(spanHTML)) { throw new Error(); }
            node.parentNode.removeChild(span);

            if (PARANOIA && getInnerHTML(dom) !== docText) { throw new Error(); }
        }

        if (PARANOIA && docText.indexOf(content, idx) !== idx) { throw new Error() }
        return idx;
    };

    var patchString = function (oldString, offset, toRemove, toInsert)
    {
        return oldString.substring(0, offset) + toInsert + oldString.substring(offset + toRemove);
    };

    var getNodeAtOffset = function (docText, offset, dom)
    {
        if (PARANOIA && dom.childNodes.length && docText !== dom.innerHTML) { throw new Error(); }
        if (offset < 0) { throw new Error(); }

        var idx = 0;
        for (var i = 0; i < dom.childNodes.length; i++) {
            var childOuterHTML = getOuterHTML(dom.childNodes[i]);
            if (PARANOIA && docText.indexOf(childOuterHTML, idx) !== idx) { throw new Error(); }
            if (i === 0 && idx >= offset) {
                return { node: dom, pos: 0 };
            }
            if (idx + childOuterHTML.length > offset) {
                var childInnerHTML = childOuterHTML;
                var tw = tagWidth(childOuterHTML);
                if (tw) {
                    childInnerHTML = childOuterHTML.substring(tw, childOuterHTML.lastIndexOf('</'));
                }
                if (offset - idx - tw < 0) {
                    if (offset - idx === 0) {
                        return { node: dom.childNodes[i], pos: 0 };
                    }
                    break;
                }
                return getNodeAtOffset(childInnerHTML, offset - idx - tw, dom.childNodes[i]);
            }
            idx += childOuterHTML.length;
        }

        if (dom.nodeName[0] === '#text') {
            if (offset > docText.length) { throw new Error(); }
            var beforeOffset = docText.substring(0, offset);
            if (beforeOffset.indexOf('&') > -1) {
                var tn = nodeFromHTML(beforeOffset);
                offset = tn.data.length;
            }
        } else {
            offset = 0;
        }

        return { node: dom, pos: offset };
    };

    var makeTextOperation = module.exports.makeTextOperation = function(oldval, newval)
    {
        if (oldval === newval) { return; }

        var begin = 0;
        for (; oldval[begin] === newval[begin]; begin++) ;

        var end = 0;
        for (var oldI = oldval.length, newI = newval.length;
             oldval[--oldI] === newval[--newI];
             end++) ;

        if (end >= oldval.length - begin) { end = oldval.length - begin; }
        if (end >= newval.length - begin) { end = newval.length - begin; }

        return {
            offset: begin,
            toRemove: oldval.length - begin - end,
            toInsert: newval.slice(begin, newval.length - end),
        };
    };

    var getChildPath = function (parent) {
        var out = [];
        for (var next = parent; next; next = getNextSiblingDeep(next, parent)) {
            out.push(next.nodeName);
        }
        return out;
    };

    var getNodePath = function (parent, node) {
        var before = [];
        var next = parent;
        for (; next && next !== node; next = getNextSiblingDeep(next, parent)) {
            before.push(next.nodeName);
        }
        if (next !== node) { throw new Error(); }

        var after = [];
        for (; next; next = getNextSiblingDeep(next, parent)) {
            after.push(next.nodeName);
        }

        return [ before, after ];
    };

    var relocatedPositionInNode = function (newNode, oldNode, offset)
    {
        if (newNode.nodeName !== '#text' || oldNode.nodeName !== '#text' || offset === 0) {
            offset = 0;
        } else if (offset >= newNode.length) {
            offset = newNode.length - 1;
        } else if (oldNode.data.substring(0, offset) === newNode.data.substring(0, offset)) {
            // keep same offset and fall through
        } else {
            var rOffset = oldNode.length - offset;
            if (oldNode.data.substring(offset) ===
                newNode.data.substring(newNode.length - rOffset))
            {
                offset = newNode.length - rOffset;
            } else {
                offset = 0;
            }
        }
        return { node: newNode, pos: offset };
    };

    var getRelocatedPosition = function (newParent, oldParent, oldNode, oldOffset)
    {
        if (oldNode === oldParent) {
            return relocatedPositionInNode(newParent, oldNode, oldOffset);
        }
        var newPath = getChildPath(newParent);

        if (newPath.length === 1) {
            return { node: null, pos: 0 };
        }

        var oldPaths = getNodePath(oldParent, oldNode);

        // The outside tags are <div> and <head> or something so we skip the first.
        newPath.shift();
        oldPaths[0].shift();
        var out = getNextSiblingDeep(newParent);

        var newPathJoined = newPath.join('|');
        if (newPathJoined.indexOf(oldPaths[0].join('|')) === 0) {
            for (var i = 1; i < oldPaths[0].length; i++) {
                out = getNextSiblingDeep(out);
            }
            return relocatedPositionInNode(out, oldNode, oldOffset);
        }
        var oldPathOneJoined = oldPaths[1].join('|');
        if (newPathJoined.indexOf(oldPathOneJoined) ===
            (newPathJoined.length - oldPathOneJoined.length))
        {
            for (var i = 0; i < newPath.length - oldPaths[1].length; i++) {
                out = getNextSiblingDeep(out);
            }
            return relocatedPositionInNode(out, oldNode, oldOffset);
        }

console.log("Could not locate node in [" + newPathJoined + "] [" + oldPaths[0].join("|") + "] [" + oldPathOneJoined + "]");
console.log(newPathJoined.indexOf(oldPathOneJoined) + "   " + (newPathJoined.length - oldPathOneJoined.length));

        return { node: newParent, pos: 0 };
    };

    // We can't create a real range until the new parent is installed in the document
    // but we need the old range to be in the document so we can do comparisons
    // so create a "pseudo" range instead.
    var getRelocatedPseudoRange = function (newParent, oldParent, range)
    {
        if (!range.startContainer) {
            throw new Error();
        }
        if (!newParent) { throw new Error(); }

        // Copy because tinkering in the dom messes up the original range.
        var startContainer = range.startContainer;
        var startOffset = range.startOffset;
        var endContainer = range.endContainer;
        var endOffset = range.endOffset;

        var newStart = getRelocatedPosition(newParent, oldParent, startContainer, startOffset);

        if (!newStart.node) {
            // there is probably nothing left of the document so just clear the selection.
            endContainer = null;
        }

        var newEnd = { node: newStart.node, pos: newStart.pos };
        if (endContainer) {
            if (endContainer !== startContainer) {
                newEnd = getRelocatedPosition(newParent, oldParent, endContainer, endOffset);
            } else if (endOffset !== startOffset) {
                newEnd = {
                    node: newStart.node,
                    pos: relocatedPositionInNode(newStart.node, endContainer, endOffset).pos
                };
            } else {
                newEnd = { node: newStart.node, pos: newStart.pos };
            }
        }

        return { start: newStart, end: newEnd };
    };

    var replaceAllChildren = function (parent, newParent)
    {
        var c;
        while ((c = parent.firstChild)) {
            parent.removeChild(c);
        }
        while ((c = newParent.firstChild)) {
            newParent.removeChild(c);
            parent.appendChild(c);
        }
    };

    var getSelectedRange = function (rangy, ifrWindow, selection) {
        selection = selection || rangy.getSelection(ifrWindow);
        if (selection.rangeCount === 0) {
            return;
        }
        var range = selection.getRangeAt(0);
        range.backward = (selection.rangeCount === 1 && selection.isBackward());
        if (!range.startContainer) {
            throw new Error();
        }

        // Occasionally, some browsers *cough* firefox *cough* will attach the range to something
        // which has been used in the past but is nolonger part of the dom...
        if (!range.startContainer || !ifrWindow.document.getElementById(range.startContainer)) {
            return;
        }

        return range;
    };

    var makeHTMLOperation = module.exports.makeHTMLOperation = (function () {

        var VOID_TAG_REGEX = new RegExp('^(' + [
            'area',
            'base',
            'br',
            'col',
            'hr',
            'img',
            'input',
            'link',
            'meta',
            'param',
            'command',
            'keygen',
            'source',
        ].join('|') + ')$');

        // Get the offset of the previous open/close/void tag.
        // returns the offset of the opening angle bracket.
        var getPreviousTagIdx = function (data, idx)
        {
            if (idx === 0) { return -1; }
            idx = data.lastIndexOf('>', idx);
            // The html tag from hell:
            // < abc def="g<hi'j >" k='lm"nopw>"qrstu"<vw'   >
            for (;;) {
                var mch = data.substring(0,idx).match(/[<"'][^<'"]*$/);
                if (!mch) { return -1; }
                if (mch[0][0] === '<') { return mch.index; }
                idx = data.lastIndexOf(mch[0][0], mch.index-1);
            }
        };

        /**
         * Get the name of an HTML tag with leading / if the tag is an end tag.
         *
         * @param data the html text
         * @param offset the index of the < bracket.
         * @return the tag name with possible leading slash.
         */
        var getTagName = function (data, offset)
        {
            if (data[offset] !== '<') { throw new Error(); }
            // Match ugly tags like <   /   xxx>
            // or <   xxx  y="z" >
            var m = data.substring(offset).match(/^(<[\s\/]*)([a-zA-Z0-9_-]+)/);
            if (!m) { throw new Error("could not get tag name"); }
            if (m[1].indexOf('/') !== -1) { return '/'+m[2]; }
            return m[2];
        };

        /**
         * Get the previous non-void opening tag.
         *
         * @param data the document html
         * @param ctx an empty map for the first call, the same element thereafter.
         * @return an array containing the offset of the open bracket for the begin tag and the
         *         the offset of the open bracket for the matching end tag.
         */
        var getPreviousNonVoidTag = function (data, ctx)
        {
            for (;;) {
                if (typeof(ctx.offsets) === 'undefined') {
                    // ' ' is an invalid html element name so it will never match anything.
                    ctx.offsets = [ { idx: data.length, name: ' ' } ];
                    ctx.idx = data.length;
                }

                var prev = ctx.idx = getPreviousTagIdx(data, ctx.idx);
                if (prev === -1) {
                    if (ctx.offsets.length > 1) { throw new Error(); }
                    return [ 0, data.length ];
                }
                var prevTagName = getTagName(data, prev);

                if (prevTagName[0] === '/') {
                    ctx.offsets.push({ idx: prev, name: prevTagName.substring(1) });
                } else if (prevTagName === ctx.offsets[ctx.offsets.length-1].name) {
                    var os = ctx.offsets.pop();
                    return [ prev, os.idx ];
                } else if (!VOID_TAG_REGEX.test(prevTagName)) {
                    throw new Error();
                }
            }
        };

        var makeOperation = function (oldval, newval)
        {
            var op = makeTextOperation(oldval, newval);
            if (!op) { return; }

            var end = op.offset + op.toRemove;
            var lastTag;
            var tag;
            var ctx = {};
            do {
                lastTag = tag;
                tag = getPreviousNonVoidTag(oldval, ctx);
            } while (tag[0] > op.offset || tag[1] < end);

            if (lastTag
                && end < lastTag[0]
                && op.offset > tag[0] + tagWidth(oldval.substring(tag[0])))
            {
                // plain old text operation.
                if (op.toRemove && oldval.substr(op.offset, op.toRemove).indexOf('<') !== -1) {
                    throw new Error();
                }
                return op;
            }

            op.offset = tag[0];
            op.toRemove = tag[1] - tag[0];
            op.toInsert = newval.slice(tag[0], newval.length - (oldval.length - tag[1]));

            if (PARANOIA) {
                // simulate running the patch.
                var res = patchString(oldval, op.offset, op.toRemove, op.toInsert);
                if (res !== newval) {
                    console.log(op);
                    console.log(oldval);
                    console.log(newval);
                    console.log(res);
                    throw new Error();
                }

                // check matching bracket count
                // TODO(cjd): this can fail even if the patch is valid because of brackets in
                //            html attributes.
                var removeText = oldval.substring(op.offset, op.offset + op.toRemove);
                if (((removeText).match(/</g) || []).length !==
                    ((removeText).match(/>/g) || []).length)
                {
                    throw new Error();
                }

                if (((op.toInsert).match(/</g) || []).length !==
                    ((op.toInsert).match(/>/g) || []).length)
                {
                    throw new Error();
                }
            }

            return op;
        };

        return function (oldval, newval) {
            try {
                return makeOperation(oldval, newval);
            } catch (e) {
                if (PARANOIA) { console.log(e.stack); }
                return {
                    offset: 0,
                    toRemove: oldval.length,
                    toInsert: newval
                };
            }
        };

    })();

    var applyHTMLOp = function (docText, op, dom, rangy, ifrWindow)
    {
        var parent = getNodeAtOffset(docText, op.offset, dom).node;
        var htmlToRemove = docText.substring(op.offset, op.offset + op.toRemove);

        var parentInnerHTML;
        var indexOfInnerHTML;
        var localOffset;
        for (;;) {
            for (;;) {
                parentInnerHTML = parent.innerHTML;
                if (typeof(parentInnerHTML) !== 'undefined'
                    && parentInnerHTML.indexOf(htmlToRemove) !== -1)
                {
                    break;
                }
                if (parent === dom || !(parent = parent.parentNode)) { throw new Error(); }
            }

            var indexOfOuterHTML = 0;
            var tw = 0;
            if (parent !== dom) {
                indexOfOuterHTML = offsetOfNodeOuterHTML(docText, parent, dom, ifrWindow);
                tw = tagWidth(docText.substring(indexOfOuterHTML));
            }
            indexOfInnerHTML = indexOfOuterHTML + tw;

            localOffset = op.offset - indexOfInnerHTML;

            if (localOffset >= 0 && localOffset + op.toRemove <= parentInnerHTML.length) {
                break;
            }

            parent = parent.parentNode;
            if (!parent) { throw new Error(); }
        }

        if (PARANOIA &&
            docText.substr(indexOfInnerHTML, parentInnerHTML.length) !== parentInnerHTML)
        {
            throw new Error();
        }

        var newParentInnerHTML =
            patchString(parentInnerHTML, localOffset, op.toRemove, op.toInsert);

        // Create a temp container for holding the children of the parent node.
        // Once we've identified the new range, we'll return the nodes to the
        // original parent. This is because parent might be the <body> and we
        // don't want to destroy all of our event listeners.
        var babysitter = ifrWindow.document.createElement('div');
        // give it a uid so that we can prove later that it's not in the document,
        // see getSelectedRange()
        babysitter.setAttribute('id', uniqueId());
        babysitter.innerHTML = newParentInnerHTML;

        var range = getSelectedRange(rangy, ifrWindow);

        // doesn't intersect at all
        if (!range || !range.containsNode(parent, true)) {
            replaceAllChildren(parent, babysitter);
            return;
        }

        var pseudoRange = getRelocatedPseudoRange(babysitter, parent, range, rangy);
        range.detach();
        replaceAllChildren(parent, babysitter);
        if (pseudoRange.start.node) {
            var selection = rangy.getSelection(ifrWindow);
            var newRange = rangy.createRange();
            newRange.setStart(pseudoRange.start.node, pseudoRange.start.pos);
            newRange.setEnd(pseudoRange.end.node, pseudoRange.end.pos);
            selection.setSingleRange(newRange);
        }
        return;
    };

    /* Return whether the selection range has been "dirtied" and needs to be reloaded. */
    var applyOp = module.exports.applyOp = function (docText, op, dom, rangy, ifrWindow)
    {
        if (PARANOIA && docText !== dom.innerHTML) { throw new Error(); }

        if (op.offset + op.toRemove > docText.length) {
            throw new Error();
        }
        //try {TODO(cjd):
            applyHTMLOp(docText, op, dom, rangy, ifrWindow);
            var result = patchString(docText, op.offset, op.toRemove, op.toInsert);
            var innerHTML = getInnerHTML(dom);
            if (result !== innerHTML) { throw new Error(); }
        /*} catch (err) {
            if (PARANOIA) { console.log(err.stack); }
            // The big hammer
            dom.innerHTML = patchString(docText, op.offset, op.toRemove, op.toInsert);
        }*/
    };

    return module.exports;
});
