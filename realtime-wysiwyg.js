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

var assert = function (expr) { if (!expr) { throw new Error(); } };
var PARANOIA = true;

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

// TODO(cjd): is it possible to have a <tag attrib="val>ue"> ?
//            in chrome the answer is no.
var tagWidth = function (nodeOuterHTML)
{
    if (nodeOuterHTML.length < 2
        || nodeOuterHTML[1] === '!'
        || nodeOuterHTML[0] !== '<')
    {
        return 0;
    }
    return nodeOuterHTML.indexOf('>') + 1;
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


var makeTextOperation = function(oldval, newval)
{
    if (oldval === newval) { return; }

    var begin = 0;
    for (; oldval[begin] === newval[begin]; begin++) ;

    var end = 0;
    for (var oldI = oldval.length, newI = newval.length; oldval[--oldI] === newval[--newI]; end++) ;

    if (end >= oldval.length - begin) { end = oldval.length - begin; }
    if (end >= newval.length - begin) { end = newval.length - begin; }

    return {
        offset: begin,
        toRemove: oldval.length - begin - end,
        toInsert: newval.slice(begin, newval.length - end),
    };
};

var makeHTMLOperation = (function () {

    // Used exclusively for error checking
    var isVoidTag = function (tag)
    {
        var ix = tag.indexOf(' ');
        if (ix > -1) {
            tag = tag.substring(0, ix);
        }
        switch (tag) {
            case 'area':
            case 'base':
            case 'br':
            case 'col':
            case 'hr':
            case 'img':
            case 'input':
            case 'link':
            case 'meta':
            case 'param':
            case 'command':
            case 'keygen':
            case 'source':
                return true;
        }
        return false;
    };

    var reverseSubstring = function (str, higher, lower)
    {
        return str.substring(str.length - lower, str.length - higher);
    };

    var getTagAtReverseOffset = function (data, roffset)
    {
        var offset = data.length - roffset;
        var end = oldval.indexOf('>', offset)
        if (offset > data.length || end < offset) { throw new Error(); }
        return data.substring(offset, end);
    };

    /**
     * Get the previous opening OR closing tag.
     * This will skip void tags such as <br>.
     *
     * @param data the html string 
     * @param offsetStack a stack containing the reverse offsets (distance from the end of the
     *                    string) of the close tags for each element in the current scope.
     * @return the index of the first letter of the name of the tag, if the tag is a closing
     *         tag, the index will point to the letter *following* the '/'.
     */
    var getPreviousTagIndex = function (data, reverseIdx, offsetStack)
    {
        var fwdIdx = data.length - reverseIdx;

        var lastTag;
        if (offsetStack.length > 0) {
            var lastOffset = data.length - offsetStack[offsetStack.length-1];
            lastTag = data.substring(lastOffset, data.indexOf('>', lastOffset));
        } else {
            lastTag = data.substring(fwdIdx, data.length-1);
            if (data[data.length-1] !== '>') { throw new Error(); }
            if (fwdIdx === 1) { throw new Error(); }
        }
        if (lastTag === '') { throw new Error(); }

        for (var i = 0; i < 1000; i++) {
            // fwdIdx-3 because lastIndex points to the first letter
            // in a tag which might be an <abc> or an </abc>
            if (fwdIdx < 3) { throw new Error(); }
            fwdIdx = data.lastIndexOf('<', fwdIdx-3);
            if (fwdIdx < 0) { throw new Error(); }
            if (data[fwdIdx+1] === '/') {
                var nextOffset = data.length - (fwdIdx+2);
                if (offsetStack[offsetStack.length-1] === nextOffset) { throw new Error(); }
                offsetStack.push(nextOffset);
                return nextOffset;
            } else {
                var tag = data.substring(fwdIdx+1, data.indexOf('>', fwdIdx));
                var idx = tag.indexOf(' ');
                if (idx > -1) { tag = tag.substring(0, idx); }
                if (tag === lastTag) {
                    offsetStack.pop();
                    return data.length - (fwdIdx+1);
                }
                if (PARANOIA && !isVoidTag(tag)) { throw new Error(); }
            }
//console.log(fwdIdx + '  [' + data + ']');
        }
        throw new Error("unreachable");
    };

    var getBeginningOfElement = function (data, lastIdx, offsetStack)
    {
        var offsetStackOrigLen = offsetStack.length;
        if (offsetStackOrigLen === 0) { throw new Error(); }
        do {
            lastIdx = getPreviousTagIndex(data, lastIdx, offsetStack);
        } while (offsetStack.length > offsetStackOrigLen);
        if (offsetStack.length !== offsetStackOrigLen - 1) { throw new Error(); }
        return lastIdx;
    };

    var makeHTMLOperation = function(oldval, newval)
    {
        if (oldval === newval) { return; }

oldval = '<body><div>'+oldval+'</div></body>';
newval = '<body><div>'+newval+'</div></body>';

        var i = 0;
        var begin = 0;
        var next = 0;
        do {
            begin = next;
            next += oldval.substring(begin+1).search(/<[^\/]/) + 1;
            if (i++ > 1000) { throw new Error(); }
        } while (i++ < 1000
                && next !== begin
                && oldval.substring(begin, next) === newval.substring(begin, next));
        // <body><div><p></p><p><br><tt>[change</tt><br> <em>here]</em></p><br><p></p></div></body>
        //                          ^~~~~ begin pointer here
        console.log(oldval);
        console.log(new Array(next+1).join(' ') + '^~~~~~');

        i = 0;
        var end = 0;
        next = 0;
        var offsetStack = [];
        do {
            end = next;
            next = getPreviousTagIndex(oldval, next, offsetStack);
            if (i++ > 1000) { throw new Error(); }
        } while (reverseSubstring(oldval, end, next) === reverseSubstring(newval, end, next));
        // <body><div><p></p><p><br><tt>[change</tt><br> <em>here]</em></p><br><p></p></div></body>
        //                                                        ^~~~~ end pointer here
        console.log(oldval);
        console.log(new Array(oldval.length + 1 - end).join(' ') + '^~~~~~');

        if (offsetStack[offsetStack.length-1] > end) { offsetStack.pop(); }
        if (offsetStack[offsetStack.length-1] > end) { throw new Error(); }

//        var offsetStackClone = [];
//        offsetStackClone.push.apply(null, offsetStack);

        // oldval
        next = offsetStack[offsetStack.length-1];
        i = 0;
        do {
            end = offsetStack[offsetStack.length-1];
            next = getBeginningOfElement(oldval, next, offsetStack);
            if (i++ > 1000) { throw new Error(); }
        } while (next + 1 < (oldval.length - begin));
        begin = oldval.length - next;
        // <body><div><p></p><p><br><tt>[change</tt><br> <em>here]</em></p><br><p></p></div></body>
        //                    ^~~~~ next                                 ^~~~~ end

        if (PARANOIA) {
            var tag = getTagAtReverseOffset(oldval, end);
            if (tag !== oldval.substr(begin, tag.length)) { throw new Error(); }
        }
        begin = oldval.indexOf('>', begin)+1;
        end += 3;

        if (PARANOIA) {
            // check begin text and end text match
            if (oldval.substring(0, begin) !== newval.substring(0, begin)) {
                throw new Error();
            }
            if (oldval.substring(oldval.length - end) !== newval.substring(newval.length - end)) {
                throw new Error();
            }
        }

        var out = {
            offset: begin,
            toRemove: oldval.length - begin - end,
            toInsert: newval.slice(begin, newval.length - end)
        };

        if (PARANOIA) {
            // check matching bracket count
            var removeText = oldval.substring(out.offset, out.offset + out.toRemove);
            if (((removeText).match(/</g) || []).length !==
                ((removeText).match(/>/g) || []).length)
            {
                throw new Error();
            }

            if (((out.toInsert).match(/</g) || []).length !==
                ((out.toInsert).match(/>/g) || []).length)
            {
                throw new Error();
            }
        }

        return out;
    };

    return makeHTMLOperation;
})();

var makeHTMLOperationOld = function(oldval, newval)
{
    if (oldval === newval) return;

    var commonStart = 0;
    while (oldval.charAt(commonStart) === newval.charAt(commonStart)) {
        commonStart++;
    }

    var begin = oldval.substring(0, commonStart);
    var lastLt = begin.lastIndexOf('<');
    if (begin.lastIndexOf('>') < lastLt) {
        commonStart = lastLt;
    }

    var commonEnd = 0;
    while (oldval.charAt(oldval.length - 1 - commonEnd) === newval.charAt(newval.length - 1 - commonEnd) &&
          commonEnd + commonStart < oldval.length && commonEnd + commonStart < newval.length) {
        commonEnd++;
    }

    var firstLt = oldval.indexOf('<', oldval.length - commonEnd);
    firstGt = oldval.indexOf('>', oldval.length - commonEnd);
    if (firstGt < firstLt || (firstLt === -1 && firstGt !== -1)) {
        commonEnd = oldval.length - firstGt - 1
//console.log("shift commonEnd");
    }

    var out = {};
    out.offset = commonStart;
    out.toRemove = oldval.length - commonStart - commonEnd;
    out.toInsert = newval.slice(commonStart, newval.length - commonEnd);
/*
console.log(out);
console.log("old: " + oldval);
console.log("new: " + newval);
*/
var removeText = oldval.substring(out.offset, out.offset + out.toRemove);
if (((removeText).match(/</g) || []).length !== ((removeText).match(/>/g) || []).length) {
    throw new Error();
}

if (((out.toInsert).match(/</g) || []).length !== ((out.toInsert).match(/>/g) || []).length) {
    throw new Error();
}

    return out;
};

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
            return;
        }

        return { node: newNodes[0], pos: oldOffset };
    };

    return function (newParent, oldParent, oldNode, oldOffset)
    {
        return (recurse(newParent, oldParent, oldNode, oldOffset, 0)
            || { node: newParent, pos: oldOffset });
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

    var newStart =
        getRelocatedPosition(newParent, oldParent, range.startContainer, range.startOffset);

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
    if (PARANOIA && docText !== dom.innerHTML) { throw new Error(); }

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

    var newParentInnerHTML = (
        parentInnerHTML.substring(0, localOffset)
      + op.toInsert
      + parentInnerHTML.substring(localOffset + op.toRemove));

    // Create a temp container for holding the children of the parent node.
    // Once we've identified the new range, we'll return the nodes to the
    // original parent. This is because parent might be the <body> and we
    // don't want to destroy all of our event listeners.
    var babysitter = ifrWindow.document.createElement('div');
    babysitter.innerHTML = newParentInnerHTML;

    var range = getSelectedRange(rangy, ifrWindow);
    if (range && range.containsNode(parent, true)) {

        var pseudoRange = getRelocatedPseudoRange(babysitter, parent, range, rangy);
        range.detach();
        replaceAllChildren(parent, babysitter);
        var selection = rangy.getSelection(ifrWindow);
        var newRange = rangy.createRange();
        newRange.setStart(pseudoRange.start.node, pseudoRange.start.pos);
        newRange.setEnd(pseudoRange.end.node, pseudoRange.end.pos);
        selection.setSingleRange(newRange);
    } else {
        replaceAllChildren(parent, babysitter);
    }
};

/* Return whether the selection range has been "dirtied" and needs to be reloaded. */
var applyTextOp = function (docText, op, dom, rangy, ifrWindow)
{
    if (PARANOIA && docText !== dom.innerHTML) { throw new Error(); }

    var nap = getNodeAtOffset(docText, op.offset, dom);
    var textNode = nap.node;
    var offset = nap.pos;
    if (textNode.nodeName !== '#text') {
        throw new Error();
    }

    if (PARANOIA) {
        var napB = getNodeAtOffset(docText, op.offset + op.toRemove, dom);
        if (napB.node !== nap.node) {
            throw new Error();
        }
    }

    var oldHTML = getOuterHTML(textNode);
    var newHTML = (
        oldHTML.substring(0,offset)
      + op.toInsert
      + oldHTML.substring(offset + op.toRemove));

    var range = getSelectedRange(rangy, ifrWindow);
    if (!range || (range.startContainer !== textNode && range.endContainer !== textNode)) {
        // fast path
        textNode.data = (newHTML === '') ? '' : nodeFromHTML(newHTML).data;
        return false;
    }

    var oldText = textNode.textContent;
    textNode.data = (newHTML === '') ? '' : nodeFromHTML(newHTML).data;
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
    rangeB.setStart(range.startContainer, getNewOffset(range.startContainer, range.startOffset));
    rangeB.setEnd(range.endContainer, getNewOffset(range.endContainer, range.endOffset));

    var selection = rangy.getSelection(ifrWindow);
    selection.setSingleRange(rangeB);

    return false;
};

/* Return whether the selection range has been "dirtied" and needs to be reloaded. */
var applyOp = function (docText, op, dom, rangy, ifrWindow)
{
    if (PARANOIA && docText !== dom.innerHTML) { throw new Error(); }

    if (op.offset + op.toRemove > docText.length) {
        throw new Error();
    }
    if (docText.substring(op.offset, op.offset + op.toRemove).indexOf('<') > -1
        || op.toInsert.indexOf('<') > -1 || true) // XXX
    {
        return applyHTMLOp(docText, op, dom, rangy, ifrWindow);
    } else {
        return applyTextOp(docText, op, dom, rangy, ifrWindow);
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












  
var start = function (rangy, sockUrl) {
    var userName = String(Math.random()).substring(2);
    var passwd = 'y';
    var channel = 'z';

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
            atomicSectionMarkers: {
                begin: '<',
                end: '>'
            }
        };
        realtime = ChainPad.create(userName, passwd, channel, oldDocText, conf);
        var onEvent = function () {

            var userDoc = realtime.getUserDoc();
            if (userDoc !== oldDocText) { throw new Error(); }


            var docText = doc.body.innerHTML;

            // chrome sometimes generates invalid html
            var docElem = doc.createElement('div');
            docElem.innerHTML = docText;
            var fixChromeOp = makeHTMLOperation(docText, docElem.innerHTML);
            if (fixChromeOp) {
                applyOp(docText,
                        fixChromeOp,
                        doc.body,
                        rangy,
                        ifr.contentWindow);

//doc.body.innerHTML = realtime.getUserDoc();
                docText = doc.body.innerHTML;
                if (docElem.innerHTML !== docText) { throw new Error(); }
            }

            var op = makeHTMLOperation(oldDocText, docText);
            if (!op) { return; }
            oldDocText = docText;
            if (op.toRemove > 0) {
                realtime.remove(op.offset, op.toRemove);
            }
            if (op.toInsert.length > 0) {
                realtime.insert(op.offset, op.toInsert);
            }

            if (realtime.getUserDoc() !== docText) { throw new Error(); }
        };

        var incomingPatch = function (patch) {
            // paranoia
            var docText = oldDocText;
            if (oldDocText !== doc.body.innerHTML) { throw new Error(); }

            for (var i = patch.operations.length-1; i >= 0; --i) {
                applyOp(docText,
                        patch.operations[i],
                        doc.body,
                        rangy,
                        ifr.contentWindow);
                docText = doc.body.innerHTML;
            }
            oldDocText = docText;

            while (realtime.getUserDoc() !== oldDocText) {
                oldDocText = realtime.getUserDoc();
                onEvent();
                oldDocText = doc.body.innerHTML;
            }
        };

        socket.onmessage = function (evt) {
            // paranoia
            onEvent();
            realtime.message(evt.data);
        };
        realtime.onMessage(function (message) { 

if ( (message.match('<') || []).length !== (message.match('>') || []).length ) {
throw new Error();
}

socket.send(message); });

        realtime.onPatch(incomingPatch);

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

require(['http://127.0.0.1:8081/rangy.js'], function () { });

document.observe('xwiki:wysiwyg:showWysiwyg', function(event) {
    require(['http://127.0.0.1:8081/rangy.js?cb='+(new Date().getTime())], function () {
        require(['http://127.0.0.1:8081/rangy-selectionsaverestore.js?cb='+(new Date().getTime())], function () {
            window.rangy.init();
            window.onerror = null;
            start(window.rangy, "ws://127.0.0.1:8080/");
        });
    });
});
