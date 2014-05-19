/* vim: set expandtab ts=4 sw=4: */
/*
 * You may redistribute this program and/or modify it under the terms of
 * the GNU Lesser General Public License as published by the Free Software
 * Foundation, either version 2.1 of the License, or (at your option) any
 * later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU Lesser General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 */
define(function () {

    var module = { exports: {} };
    var PARANOIA = true;

    var debug = function (x) { };
    debug = function (x) { console.log(x); };

    var drillDown = function (node)
    {
        while (node.childNodes[0]) { node = node.childNodes[0]; }
        return node;
    };

    var getNextSiblingDeep = function (node)
    {
        if (node.firstChild) { return node.firstChild; }
        if (node.nextSibling) { return node.nextSibling; }
        if (node.parentNode) { return node.parentNode.nextSibling; }
    };

    var getPreviousSiblingDeep = function (node)
    {
        if (node.previousSibling) {
            node = node.previousSibling;
            while (node.lastChild) { node = node.lastChild; }
            return node;
        }
        return node.parentNode;
    };

    var decendsFrom = function (maybeChild, maybeParent)
    {
        for (;;) {
            if (!maybeChild) { return false; }
            if (maybeChild === maybeParent) { return true; }
            maybeChild = maybeChild.parentNode;
        }
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


    var makeTextOperation = window.makeTextOperation = function(oldval, newval)
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

    var makeHTMLOperation = (function () {

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

    var htmlOperationSimplify = function (op, origText, origOpSimplify)
    {
        // Try to be fast because this is called often.
        var orig = origOpSimplify(op, origText, origOpSimplify);
        if (!orig) { return null; }
        if (!op.toInsert.match(/[<>]/) && !origText.substr(op.offset, op.toRemove).match(/[<>]/)) {
            return orig;
        }
        if (orig.offset === op.offset
            && orig.toRemove === op.toRemove
            && orig.toInsert === op.toInsert)
        {
            return op;
        }
        // slooooooooow
        var newText = patchString(origText, op.offset, op.toRemove, op.toInsert);
        return makeHTMLOperation(origText, newText);
    };



    /**
     * Attempt to locate a position in a newly altered parent node which represents
     * the same location as the position in the old node.
     * This is inherently huristic and might be unable to find the position, returning
     * instead the beginning of the new parent node.
     * This function works by taking the outerHTML of the interesting node and searching
     * for matching HTML of a node within the new parent. If it is not found or if
     * multiple nodes are discovered which look the same, it will try the next sibling
     * of this node, walking forward one node at a time to the end of the document searching
     * for a unique node which is seen in both the new and old parent elements.
     * If searching forward ends without success, it will search backward and if that too
     * ends without a successful discovery of a matching node, it will fail and return the
     * parent node with offset zero which in practice will cause the cursor to relocate to
     * the beginning of the highest node which was altered by the operation, hopefully rare.
     *
     * @param newParent the new parent element
     * @param oldParent the old (replaced) parent element
     * @param oldNode the node (a decendent of oldParent) which represents the position
     * @param oldOffset the number of characters offset from the beginning of oldNode which
     *                  represents the position.
     * @return an object containing "node" (the new node) and "pos" the offset within the new
     *         node.
     */
    var getRelocatedPosition = (function () {
        var recurse = function (newParent, oldParent, oldNode, oldOffset, backward)
        {
            var nodeHTML = getOuterHTML(oldNode);
            var newNodes = [];
            for (var nextNode = newParent; nextNode = getNextSiblingDeep(nextNode);) {
                if (getOuterHTML(nextNode) === nodeHTML) { newNodes.push(nextNode); }
            }
            if (newNodes.length !== 1) {
                // search forward looking for a matching node
                var nextSiblingDeep = getNextSiblingDeep(oldNode);
                if (nextSiblingDeep && decendsFrom(nextSiblingDeep, oldParent)) {
                    if (!backward) {
                        var relocated = recurse(newParent, oldParent, nextSiblingDeep, 0, 0);
                        if (relocated) {
                            relocated.node = getPreviousSiblingDeep(relocated.node);
                            relocated.pos = oldOffset;
                        }
                        return relocated;
                    }
                    // try a reverse search
                    var previousSiblingDeep = getPreviousSiblingDeep(oldNode);
                    if (previousSiblingDeep && decendsFrom(previousSiblingDeep, oldParent)) {
                        var relocated = recurse(newParent, oldParent, previousSiblingDeep, 0, 1);
                        if (relocated) {
                            relocated.node = getNextSiblingDeep(relocated.node);
                            relocated.pos = oldOffset;
                        }
                        return relocated;
                    }
                }
                // fail
                debug("Failed to relocate position");
                return;
            }

            return { node: newNodes[0], pos: oldOffset };
        };

        return function (newParent, oldParent, oldNode, oldOffset)
        {
            var out = recurse(newParent, oldParent, oldNode, oldOffset, 0);
            if (!out || !out.node) { out = { node: newParent, pos: oldOffset }; }
            return out;
        };
    })();

    var checkOffset = function (node, offset)
    {
        if (offset === 0) { return offset; }
        if (node.nodeName[0] === '#' && offset < node.length) { return offset; }
        return 0;
    };

    // We can't create a real range until the new parent is installed in the document
    // but we need the old range ot be in the document so we can do comparisons
    // so create a "pseudo" range instead.
    var getRelocatedPseudoRange = function (newParent, oldParent, range)
    {
        if (!range.startContainer) {
            throw new Error();
        }
        if (!newParent) { throw new Error(); }

        var newStart =
            getRelocatedPosition(newParent, oldParent, range.startContainer, range.startOffset);

        if (!newStart.node) { throw new Error(); }

        newStart.pos = checkOffset(newStart.node, newStart.pos);
        var newEnd = { node: newStart.node, pos: newStart.pos };
        if (range.endContainer) {
            if (range.endContainer === range.startContainer) {
                newEnd = newStart;
            } else {
                newEnd =
                    getRelocatedPosition(newParent, oldParent, range.endContainer, range.endOffset);
                newEnd.pos = checkOffset(newEnd.node, newEnd.pos);
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
        return range;
    };

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

        if (docText.substr(indexOfInnerHTML, parentInnerHTML.length) !== parentInnerHTML) {
            throw new Error();
        }

        var newParentInnerHTML =
            patchString(parentInnerHTML, localOffset, op.toRemove, op.toInsert);

        // Create a temp container for holding the children of the parent node.
        // Once we've identified the new range, we'll return the nodes to the
        // original parent. This is because parent might be the <body> and we
        // don't want to destroy all of our event listeners.
        var babysitter = ifrWindow.document.createElement('div');
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
        var selection = rangy.getSelection(ifrWindow);
        var newRange = rangy.createRange();
        newRange.setStart(pseudoRange.start.node, pseudoRange.start.pos);
        newRange.setEnd(pseudoRange.end.node, pseudoRange.end.pos);
        selection.setSingleRange(newRange);
        return;
    };

    var applyTextOp = function (docText, op, dom, rangy, ifrWindow)
    {
        var nap = getNodeAtOffset(docText, op.offset, dom);
        var textNode = nap.node;
        var offset = nap.pos;
        if (textNode.nodeName !== '#text') {
            // It's possible that even though the operation looks like a text op,
            // there is just no text node in the location where the op is to occur.
            // In this case we'll call applyHTMLOp() and be done.
            debug('textOp not possible, doing html op');
            applyHTMLOp(docText, op, dom, rangy, ifrWindow);
            return;
        }

        if (PARANOIA) {
            var napB = getNodeAtOffset(docText, op.offset + op.toRemove, dom);
            if (napB.node !== nap.node) { throw new Error(); }
        }

        var oldHTML = getOuterHTML(textNode);
        var newHTML = patchString(oldHTML, op.offset - offset, op.toRemove, op.toInsert);

        var range = getSelectedRange(rangy, ifrWindow);
        if (!range || (range.startContainer !== textNode && range.endContainer !== textNode)) {
            // fast path
            textNode.data = (newHTML === '') ? '' : nodeFromHTML(newHTML).data;
            return;
        }

        // Capture these values because they might be changed during the insert.
        var rangeStartOffset = range.startOffset;
        var rangeEndOffset = range.endOffset;
        var rangeStartContainer = range.startContainer;
        var rangeEndContainer = range.endContainer;

        var oldText = textNode.textContent;
        textNode.data = (newHTML === '') ? '' : nodeFromHTML(newHTML).data;
debug("textNode.data = " + textNode.data);
        var newText = textNode.textContent;

        // do this again because the text might have escaped html crap
        // in it which we'd need to account for.
        var textOp = makeTextOperation(oldText, newText);
        var getNewOffset = function (cont, os) {
            if (cont !== textNode) { return os; }
            if (os > textOp.offset) {
                if (os <= textOp.offset + textOp.toRemove) {
                    return textOp.offset;
                }
                return os + textOp.toInsert.length - textOp.toRemove;
            }
            return os;
        };

        var rangeB = rangy.createRange();
        rangeB.setStart(rangeStartContainer, getNewOffset(rangeStartContainer, rangeStartOffset));
        rangeB.setEnd(rangeEndContainer, getNewOffset(rangeEndContainer, rangeEndOffset));

        var selection = rangy.getSelection(ifrWindow);
        selection.setSingleRange(rangeB);

        return;
    };

    /* Return whether the selection range has been "dirtied" and needs to be reloaded. */
    var applyOp = function (docText, op, dom, rangy, ifrWindow)
    {
        if (PARANOIA && docText !== dom.innerHTML) { throw new Error(); }

        if (op.offset + op.toRemove > docText.length) {
            throw new Error();
        }
        try {
            if (op.toInsert.indexOf('<') > -1
                || docText.substring(op.offset, op.offset + op.toRemove).indexOf('<') > -1 || true) // XXX
            {
                debug('change contains brackets, htmlOp');
                return applyHTMLOp(docText, op, dom, rangy, ifrWindow);
            } else {
                try {
                    return applyTextOp(docText, op, dom, rangy, ifrWindow);
                } catch (err) {
                    if (PARANOIA) { console.log(err.stack); }
                    return applyHTMLOp(docText, op, dom, rangy, ifrWindow);
                }
            }
        } catch (err) {
            if (PARANOIA) { console.log(err.stack); }
            // The big hammer
            dom.innerHTML = patchString(docText, op.offset, op.toRemove, op.toInsert);
        }
    };



    // ------------------ Trapping Keyboard Events ---------------------- //

    var bindEvents = function (element, events, callback, unbind) {
        for (var i = 0; i < events.length; i++) {
            var e = events[i];
            if (element.addEventListener) {
                if (unbind) {
                    element.removeEventListener(e, callback, false);
                } else {
                    element.addEventListener(e, callback, false);
                }
            } else {
                if (unbind) {
                    element.detachEvent('on' + e, callback);
                } else {
                    element.attachEvent('on' + e, callback);
                }
            }
        }
    };

    var bindAllEvents = function (wysiwygDiv, docBody, onEvent, unbind)
    {
        bindEvents(docBody,
                   ['textInput', 'keydown', 'keyup', 'select', 'cut', 'paste'],
                   onEvent,
                   unbind);
        bindEvents(wysiwygDiv,
                   ['mousedown','mouseup','click'],
                   onEvent,
                   unbind);
    };

    var updateUserList = function (myUserName, listElement, userList)
    {
        var meIdx = userList.indexOf(myUserName);
        if (meIdx === -1) {
            console.log("user list ["+userList+"] does not contain self ["+myUserName+"]...");
            listElement.setAttribute('value', "Disconnected");
            return;
        }
        var userMap = { "Myself":1 };
        userList.splice(meIdx, 1);
        for (var i = 0; i < userList.length; i++) {
            var user = userList[i].replace(/-.*/, '');
            if (user === 'xwiki:XWiki.XWikiGuest') { user = 'Guest'; }
            userMap[user] = userMap[user] || 0;
            if (user === 'Guest' && userMap[user] > 0) {
                userMap['Guests'] = userMap[user];
                delete userMap[user];
                user = 'Guests';
            }
            userMap[user]++;
        }
        var userListOut = [];
        for (var name in userMap) {
            if (userMap[name] > 1) {
                userListOut.push(userMap[name] + " " + name);
            } else {
                userListOut.push(name);
            }
        }
        userListOut[userListOut.length-1] = 'and ' + userListOut[userListOut.length-1];
        listElement.setAttribute('value', 'Editing with: ' + userListOut.join(', '));
    };

    var start = module.exports.start = function (ChainPad, userName, channel, rangy, sockUrl) {
        var passwd = 'y';
        var wysiwygDiv = document.getElementsByClassName('xRichTextEditor')[0];
        var ifr = wysiwygDiv.getElementsByClassName('gwt-RichTextArea')[0];
        var doc = ifr.contentWindow.document;
        var socket = new WebSocket(sockUrl);
        socket.onerror = function (e) { console.log('socket error ' + e); };
        socket.onopen = function(evt) {
            var oldDocText = doc.body.innerHTML;
            var oldDocElem = document.createElement('div');
            oldDocElem.innerHTML = oldDocText;

            var conf = {
                //operationSimplify: htmlOperationSimplify
            };
            realtime = ChainPad.create(userName, passwd, channel, oldDocText, conf);
            var onEvent = function () {

    //            var userDoc = realtime.getUserDoc();
    //            if (userDoc !== oldDocText) { throw new Error(); }

                var docText = doc.body.innerHTML;
                if (oldDocText === docText) { return; }

                // chrome sometimes generates invalid html
                var docElemHTML = (function () {
                    var docElem = doc.createElement('div');
                    docElem.innerHTML = docText;
                    return docElem.innerHTML;
                })();
                var fixChromeOp = makeHTMLOperation(docText, docElemHTML);
                if (fixChromeOp) {
                    applyOp(docText,
                            fixChromeOp,
                            doc.body,
                            rangy,
                            ifr.contentWindow);
                    docText = doc.body.innerHTML;
                    if (docElemHTML !== docText) { throw new Error(); }
                }

                var op = makeHTMLOperation(oldDocText, docText);

                if (op.toRemove > 0) {
                    realtime.remove(op.offset, op.toRemove);
                }
                if (op.toInsert.length > 0) {
                    realtime.insert(op.offset, op.toInsert);
                }

                oldDocText = docText;
                if (realtime.getUserDoc() !== docText) { throw new Error(); }
            };

            var incomingPatch = function (patch) {

                var docText = doc.body.innerHTML;
                //if (oldDocText !== doc.body.innerHTML) { throw new Error(); }
                var rtDoc = realtime.getUserDoc();
                if (docText === rtDoc) { return; }
                var op = makeHTMLOperation(docText, rtDoc);
                applyOp(docText, op, doc.body, rangy, ifr.contentWindow);
                oldDocText = doc.body.innerHTML;

                /*while (realtime.getUserDoc() !== oldDocText) {
                    oldDocText = realtime.getUserDoc();
                    onEvent();
                    oldDocText = doc.body.innerHTML;
                }*/
            };

            socket.onmessage = function (evt) {
                // paranoia
                onEvent();
                realtime.message(evt.data);
            };
            realtime.onMessage(function (message) { 
                socket.send(message);
            });

            realtime.onPatch(incomingPatch);

            var realtimeUserList = document.getElementById('realtime-user-list');
            if (realtimeUserList) {
                realtime.onUserListChange(function (userList) {
                    updateUserList(userName, realtimeUserList, userList);
                });
            }

            bindAllEvents(wysiwygDiv, doc.body, onEvent, false);

            setInterval(function () {
                // reconnect if the iframe changes...
                if (ifr === document.getElementsByClassName('gwt-RichTextArea')[0]) { return; }
                bindAllEvents(wysiwygDiv, doc.body, onEvent, true);
                wysiwygDiv = document.getElementsByClassName('xRichTextEditor')[0];
                ifr = wysiwygDiv.getElementsByClassName('gwt-RichTextArea')[0];
                doc = ifr.contentWindow.document;
                bindAllEvents(wysiwygDiv, doc.body, onEvent, false);
                onEvent();
            }, 200);

            realtime.start();

            console.log('started');
        };
    };


    return module.exports;
});
