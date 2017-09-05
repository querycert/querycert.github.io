// some types
var __extends = (this && this.__extends) || (function () {
    var extendStatics = Object.setPrototypeOf ||
        ({ __proto__: [] } instanceof Array && function (d, b) { d.__proto__ = b; }) ||
        function (d, b) { for (var p in b) if (b.hasOwnProperty(p)) d[p] = b[p]; };
    return function (d, b) {
        extendStatics(d, b);
        function __() { this.constructor = d; }
        d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
    };
})();
// constants
// these must remain 100 for the puzzle piece path stuff to work out
var piecewidth = 100;
var pieceheight = 100;
// const gridRows = 2;
var gridRows = 1; // Only one interactive row for now -JS
var pipelineRow = 0;
var gridOffset = new fabric.Point(22, 20);
var canvasHeightInteractive = gridRows * pieceheight + gridOffset.y * 2;
// we should set canvas width appropriately
var totalCanvasWidth = 1000;
// Value for the 'accept' attribute for schema input (hardwired for now)
var schemaAccept = ".json,.schema,.io,.ddl";
// Value for the 'accept' attribute for non-csv data input (hardwired for now)
var dataAccept = ".json,.input,.io,.data";
// Error message for compile and execute tab when the source and target languages are not specified
var sourceAndTargetRequired = "[ Both source and target languages must specified ]";
// Error message for compile and execute (non-javascript) tab when the source and target languages are specified but the query src is not
var noQuerySrc = "[ Query contents have not been specified ]";
// Placeholder optimization when there are no optimizations chosen in a phase tab
var optPlaceholder = "Add optimizations here";
// global variables
// The web-worker that is actively running a query or null.  The kill button should only be visible when this is non-null.
var worker = null;
// The top-level tab manager (providing access to it from global functions)
var tabManager;
// The main canvas (for late (re)-construction of tabs to be replaced in the top-level tab manager
var mainCanvas;
// Functions
// A placeholder to fetch ancillary information not currently in QcertLanguageDescription
// TODO integrate this
function getSourceLanguageExtraInfo(source) {
    switch (source) {
        case "sql":
            return { accept: ".sql", schemaForCompile: false };
        case "sqlpp":
            return { accept: ".sqlpp", schemaForCompile: false };
        case "oql":
            return { accept: ".oql", schemaForCompile: false };
        case "lambda_nra":
            return { accept: ".lnra", schemaForCompile: false };
        case "tech_rule":
            return { accept: ".arl", schemaForCompile: true };
        case "designer_rule":
            return { accept: ".sem", schemaForCompile: false };
        case "camp_rule":
            return { accept: ".rule,.camp", schemaForCompile: false };
        default:
            return undefined;
    }
}
// Executes when the kill button is pressed.  The kill button should only be visible when an execution is running, whether or not the execution tab is showing
function killButton() {
    if (worker != null) {
        worker.terminate();
        worker = null;
        var executing = getExecOutputArea();
        if (executing != null)
            executing.value = "[ Execution interrupted ]";
        document.getElementById("kill-button").style.display = "none";
    }
}
// Executes when compile button is pressed.  This button shows when the compile tab shows.
function compileButton() {
    var langs = getPipelineLangs();
    var optimconf = getOptimConfig();
    var srcInput = getSrcInput();
    var schemaInput = getSchemaInput();
    var theTextArea = document.getElementById("compile-tab-query-output-text");
    var path = langs.map(function (x) { return x.id; });
    if (path.length <= 2) {
        theTextArea.value = sourceAndTargetRequired;
        return;
    }
    else if (srcInput.length == 0) {
        theTextArea.value = noQuerySrc;
        return;
    }
    else if (schemaInput.length == 0 || schemaInput == "{}") {
        if (getSourceLanguageExtraInfo(path[0]).schemaForCompile) {
            theTextArea.value = "[ The " + path[0] + " language requires a schema for compilation ]";
            return;
        }
    }
    theTextArea.value = "[ Compiling query ]";
    var middlePath = path.slice(1, -1);
    var handler = function (resultPack) {
        theTextArea.value = resultPack.result;
    };
    qcertPreCompile({
        source: path[0],
        target: path[path.length - 1],
        path: middlePath,
        exactpath: true,
        emitall: true,
        sourcesexp: false,
        ascii: false,
        javaimports: undefined,
        query: srcInput,
        schema: schemaInput,
        eval: false,
        input: undefined,
        optims: JSON.stringify(optimconf) /* XXX Add optimizations here XXX */
    }, handler);
}
// Executes when execute button is pressed.  This button shows when the execute tab shows.
function executeButton() {
    var langs = getPipelineLangs();
    var optimconf = getOptimConfig();
    var path = langs.map(function (x) { return x.id; });
    var executing = getExecOutputArea();
    if (worker != null) {
        executing.value = " [ A previous query is still executing and must be killed in order to execute a new one ]";
        return;
    }
    if (path.length <= 2) {
        executing.value = sourceAndTargetRequired;
        return;
    }
    var dataInput = getIOInput();
    if (dataInput.length == 0) {
        executing.value = "[ No input data specified ]";
        return;
    }
    executing.value = "[ Executing query ]";
    // expose the kill button
    document.getElementById("kill-button").style.display = "block";
    // Additional inputs
    var target = langs[langs.length - 1].id;
    var schemaInput = getSchemaInput();
    // Setup to handle according to target language
    var arg = target == "js" ? setupJsEval(dataInput, schemaInput) :
        setupQcertEval(path, getSrcInput(), schemaInput, dataInput, optimconf);
    if (arg == null)
        return;
    // Processing is delegated to a web-worker
    try {
        // Worker variable is global (also executing and executingCanvas), making it (them) accessible to the killButton() function
        worker = new Worker("evalWorker.js");
        worker.onmessage = function (e) {
            workerComplete(e.data);
        };
        worker.onerror = function (e) {
            workerComplete(e.message);
        };
        console.log("About to post");
        console.log(arg);
        worker.postMessage(arg);
    }
    catch (err) {
        workerComplete(err.message);
    }
}
function setupJsEval(inputString, schemaText) {
    var compiledQuery = getCompiledQuery();
    if (compiledQuery == null) {
        var executing = getExecOutputArea();
        executing.value = "[ The query has not been compiled ]";
        return null;
    }
    return [inputString, schemaText, compiledQuery];
}
function workerComplete(text) {
    var executing = getExecOutputArea();
    executing.value = text;
    document.getElementById("kill-button").style.display = "none";
    worker = null;
}
function setupQcertEval(path, srcInput, schemaInput, dataInput, optimconf) {
    if (srcInput.length == 0) {
        var executing = getExecOutputArea();
        executing.value = noQuerySrc;
        return null;
    }
    var middlePath = path.slice(1, -1);
    return { source: path[0],
        target: path[path.length - 1],
        path: middlePath,
        exactpath: true,
        emitall: true,
        sourcesexp: false,
        ascii: false,
        javaimports: undefined,
        query: srcInput,
        schema: schemaInput,
        eval: true,
        input: dataInput,
        optims: JSON.stringify(optimconf) /* XXX Add optimizations here XXX */
    };
}
// Executes when defaults button is pushed on the optim config tab
function defaultConfig() {
    setConfig(qcertOptimDefaults().optims);
    setConfigStatus("Default configuration was loaded.", false);
}
// Executes when clear button is pushed on the optim config tab
function clearConfig() {
    setConfig(getClearConfig());
    setConfigStatus("Configuration starting from scratch", false);
}
// Executes when save button is pushed on the optim config tab
function saveConfig() {
    var config = JSON.stringify(getOptimConfig());
    var blob = new Blob([config], { type: 'text/plain' });
    var url = URL.createObjectURL(blob);
    var link = document.createElement('a');
    link.href = url;
    link.download = "optimizations";
    link.click();
}
function getClearConfig() {
    function clearOptimsInPhaseList(array) {
        array.forEach(function (elem) { return elem.optims = [optPlaceholder]; });
    }
    function clearOptimsInTopList(array) {
        array.forEach(function (elem) { return clearOptimsInPhaseList(elem.phases); });
        return array;
    }
    return clearOptimsInTopList(qcertOptimDefaults().optims);
}
function setConfigStatus(text, usedFileChooser) {
    var msgarea = document.getElementById('config-message');
    msgarea.innerHTML = text;
    if (usedFileChooser)
        return;
    // Buttons that alter the config without going through the file chooser should clear file chooser state, which is no longer valid
    var chooser = document.getElementById('load-optims');
    chooser.value = "";
}
function setConfig(optims) {
    var newOptimsTab = OptimizationsTabMakeFromConfig(mainCanvas, optims);
    tabManager.replaceTab(newOptimsTab, 1);
    mainCanvas.renderAll();
}
function getSourceLeft(left) {
    return left * (piecewidth + 30) + 20;
}
function getSourceTop(top) {
    return canvasHeightInteractive + top * (pieceheight + 30) + 20;
}
// The set of languages and their properties
// const srcLanguageGroups:SourceLanguageGroups = {
//     frontend:[{langid:'sql', label:'SQL'}, {langid:'oql', label:'OQL'}],
//     intermediate:[{langid:'nrae', label:'NRAenv'}, {langid:'nrc', label:'NNRC'}],
//     backend:[{langid:'js', label:'javascript'}, {langid:'cloudant', label:'Cloudant'}]};
function toSrcLangDescript(color, sides) {
    return function (group) {
        return { langid: group.langid, label: group.label, langdescription: group.description, fill: color, sides: sides };
    };
}
function getSrcLangDescripts(langGroups) {
    var ret = [];
    ret.push(langGroups.frontend.map(toSrcLangDescript('#91D050', { right: -1 })));
    ret.push(langGroups.core.map(toSrcLangDescript('#7AB0DD', { left: 1, right: -1 })));
    ret.push(langGroups.distributed.map(toSrcLangDescript('#7AB0DD', { left: 1, right: -1 })));
    ret.push(langGroups.backend.map(toSrcLangDescript('#ED7D32', { left: 1 })));
    return ret;
}
// the boundary between the interactive and the selections
var separatorLine = new fabric.Line([0, canvasHeightInteractive, totalCanvasWidth, canvasHeightInteractive], { stroke: '#ccc', selectable: false });
function updateCanvasWidth(canvas, newWidth) {
    totalCanvasWidth = newWidth;
    canvas.setWidth(newWidth);
    separatorLine.set('x2', newWidth);
}
function ensureCanvasWidth(canvas, newWidth) {
    if (newWidth > totalCanvasWidth) {
        updateCanvasWidth(canvas, newWidth);
    }
}
function ensureCanvasInteractivePieceWidth(canvas, lastpiece) {
    ensureCanvasWidth(canvas, lastpiece * piecewidth);
}
function ensureCanvasSourcePieceWidth(canvas, lastpiece) {
    ensureCanvasWidth(canvas, getSourceLeft(lastpiece));
}
// Add support for hit testig individual objects in a group
// from http://stackoverflow.com/questions/15196603/using-containspoint-to-select-object-in-group#15210884
fabric.util.object.extend(fabric.Object.prototype, {
    getAbsoluteCenterPoint: function () {
        var point = this.getCenterPoint();
        if (!this.group)
            return point;
        var groupPoint = this.group.getAbsoluteCenterPoint();
        return {
            x: point.x + groupPoint.x,
            y: point.y + groupPoint.y
        };
    },
    containsInGroupPoint: function (point) {
        if (!this.group)
            return this.containsPoint(point);
        var center = this.getAbsoluteCenterPoint();
        var thisPos = {
            xStart: center.x - this.width / 2,
            xEnd: center.x + this.width / 2,
            yStart: center.y - this.height / 2,
            yEnd: center.y + this.height / 2
        };
        if (point.x >= thisPos.xStart && point.x <= (thisPos.xEnd)) {
            if (point.y >= thisPos.yStart && point.y <= thisPos.yEnd) {
                return true;
            }
        }
        return false;
    }
});
// based on code from https://www.codeproject.com/articles/395453/html-jigsaw-puzzle
function getMask(tileRatio, topTab, rightTab, bottomTab, leftTab) {
    var curvyCoords = [0, 0, 35, 15, 37, 5, 37, 5, 40, 0, 38, -5, 38, -5,
        20, -20, 50, -20, 50, -20, 80, -20, 62, -5, 62, -5, 60, 0, 63,
        5, 63, 5, 65, 15, 100, 0];
    var tileWidth = 100;
    var tileHeight = 100;
    var mask = "";
    var leftx = -4;
    var topy = 0;
    var rightx = leftx + tileWidth;
    var bottomy = topy + tileHeight;
    mask += "M" + leftx + "," + topy;
    //Top
    for (var i = 0; i < curvyCoords.length / 6; i++) {
        mask += "C";
        mask += leftx + curvyCoords[i * 6 + 0] * tileRatio;
        mask += ",";
        mask += topy + topTab * curvyCoords[i * 6 + 1] * tileRatio;
        mask += ",";
        mask += leftx + curvyCoords[i * 6 + 2] * tileRatio;
        mask += ",";
        mask += topy + topTab * curvyCoords[i * 6 + 3] * tileRatio;
        mask += ",";
        mask += leftx + curvyCoords[i * 6 + 4] * tileRatio;
        mask += ",";
        mask += topy + topTab * curvyCoords[i * 6 + 5] * tileRatio;
    }
    //Right
    for (var i = 0; i < curvyCoords.length / 6; i++) {
        mask += "C";
        mask += rightx - rightTab * curvyCoords[i * 6 + 1] * tileRatio;
        mask += ",";
        mask += topy + curvyCoords[i * 6 + 0] * tileRatio;
        mask += ",";
        mask += rightx - rightTab * curvyCoords[i * 6 + 3] * tileRatio;
        mask += ",";
        mask += topy + curvyCoords[i * 6 + 2] * tileRatio;
        mask += ",";
        mask += rightx - rightTab * curvyCoords[i * 6 + 5] * tileRatio;
        mask += ",";
        mask += topy + curvyCoords[i * 6 + 4] * tileRatio;
    }
    //Bottom
    for (var i = 0; i < curvyCoords.length / 6; i++) {
        mask += "C";
        mask += rightx - curvyCoords[i * 6 + 0] * tileRatio;
        mask += ",";
        mask += bottomy - bottomTab * curvyCoords[i * 6 + 1] * tileRatio;
        mask += ",";
        mask += rightx - curvyCoords[i * 6 + 2] * tileRatio;
        mask += ",";
        mask += bottomy - bottomTab * curvyCoords[i * 6 + 3] * tileRatio;
        mask += ",";
        mask += rightx - curvyCoords[i * 6 + 4] * tileRatio;
        mask += ",";
        mask += bottomy - bottomTab * curvyCoords[i * 6 + 5] * tileRatio;
    }
    //Left
    for (var i = 0; i < curvyCoords.length / 6; i++) {
        mask += "C";
        mask += leftx + leftTab * curvyCoords[i * 6 + 1] * tileRatio;
        mask += ",";
        mask += bottomy - curvyCoords[i * 6 + 0] * tileRatio;
        mask += ",";
        mask += leftx + leftTab * curvyCoords[i * 6 + 3] * tileRatio;
        mask += ",";
        mask += bottomy - curvyCoords[i * 6 + 2] * tileRatio;
        mask += ",";
        mask += leftx + leftTab * curvyCoords[i * 6 + 5] * tileRatio;
        mask += ",";
        mask += bottomy - curvyCoords[i * 6 + 4] * tileRatio;
    }
    return mask;
}
function makeToolTip(tip, canvas, srcRect, tooltipOffset, textOptions, rectOptions) {
    var topts = fabric.util.object.clone(textOptions);
    topts.left = 0;
    topts.top = 0;
    topts.editable = false;
    var text = new fabric.IText(tip, topts);
    // calculate where it should appear.
    // if needed, shrink the font so that the text
    // is not too large
    var boundingBox = text.getBoundingRect();
    var maxwidth = canvas.getWidth() * 3 / 4;
    while (boundingBox.width > maxwidth) {
        text.setFontSize(text.getFontSize() - 2);
        text.setCoords();
        boundingBox = text.getBoundingRect();
    }
    var piecemid = srcRect.left + Math.round(srcRect.width / 2);
    var boxleft = piecemid - Math.round(boundingBox.width / 2);
    if (boxleft < 0) {
        boxleft = 0;
    }
    else {
        var tryright = piecemid + Math.round(boundingBox.width / 2);
        tryright = Math.min(tryright, canvas.getWidth());
        boxleft = tryright - boundingBox.width;
    }
    var boxtop = srcRect.top - boundingBox.height - tooltipOffset.y;
    if (boxtop < 0) {
        boxtop = srcRect.top + srcRect.height + tooltipOffset.y;
    }
    text.originX = 'left';
    text.left = boxleft;
    text.originY = 'top';
    text.top = boxtop;
    text.setCoords();
    var ropts = fabric.util.object.clone(rectOptions);
    fabric.util.object.extend(ropts, text.getBoundingRect());
    var box = new fabric.Rect(ropts);
    var group = new fabric.Group([box, text]);
    return group;
}
// Either move sourcePieces inside the builder or move its initialization
// out to avoid maintenance/ordering problems
// These are two critical arrays for the buider
// This is the collection of source pieces
var sourcePieces = {};
// This is the matrix of pieces that are in the grid
var placedPieces = [];
var errorPiece;
// function assignBackingObject(frontingObject:FrontingObject, backingObject:fabric.IObject) {
// 	// disassociate the backingObject from any previous owner
// 	if(isBackingObject(backingObject)) {
// 		const oldObject = backingObject.frontingObject;
// 		oldObject.deassociate();
// 		delete oldObject.backingObject;
// 	}
// 	(<any>backingObject).frontingObject = frontingObject;
// 	frontingObject.backingObject = <BackingObject>(backingObject);
// 	frontingObject.associate();
// }
var GriddablePuzzlePiece = (function () {
    function GriddablePuzzlePiece() {
    }
    GriddablePuzzlePiece.prototype.getGridPoint = function () {
        return new fabric.Point(Math.round((this.backingObject.left + this.puzzleOffset.x - gridOffset.x) / piecewidth), Math.round((this.backingObject.top + this.puzzleOffset.y - gridOffset.y) / pieceheight));
    };
    ;
    GriddablePuzzlePiece.prototype.setGridPoint = function (point) {
        this.setGridCoords(point.x, point.y);
    };
    ;
    GriddablePuzzlePiece.prototype.setGridCoords = function (x, y) {
        this.backingObject.left = x * piecewidth - this.puzzleOffset.x + gridOffset.x;
        this.backingObject.top = y * pieceheight - this.puzzleOffset.y + gridOffset.y;
        this.backingObject.setCoords();
    };
    ;
    GriddablePuzzlePiece.calcPuzzleEdgeOffset = function (side) {
        if (side < 0) {
            return 9;
        }
        else if (side > 0) {
            return 20;
        }
        else {
            return 0;
        }
    };
    return GriddablePuzzlePiece;
}());
var Grid = (function () {
    function Grid() {
    }
    Grid.remove = function (location) {
        var prow = placedPieces[location.y];
        if (prow === undefined) {
            return;
        }
        for (var i = location.x; i < prow.length; i++) {
            var p = i + 1 < prow.length ? prow[i + 1] : undefined;
            prow[i] = p;
            if (p !== undefined) {
                p.setGridCoords(i, location.y);
            }
        }
    };
    Grid.removeAndHide = function (location) {
        var prow = placedPieces[location.y];
        if (prow === undefined) {
            return;
        }
        var p = prow[location.x];
        Grid.remove(location);
        if (p !== undefined) {
            p.hide();
        }
    };
    Grid.addAndShow = function (location, pieces) {
        Grid.add(location, pieces);
        if (pieces instanceof Array) {
            pieces.forEach(function (p) { p.show(); });
        }
        else {
            pieces.show();
        }
    };
    /**
     * @param location The location where the first piece will be inserted
     * @param piece The piece(s) to be inserted.  The piece
     *        locations are not set. If this is desired, call {@link fixup locations}
     * @returns the number of pieces that were moved out of the way
     */
    Grid.add = function (location, pieces) {
        var prow = placedPieces[location.y];
        if (!(pieces instanceof Array)) {
            pieces = [pieces];
        }
        var numPieces = pieces.length;
        if (prow === undefined) {
            prow = [];
            placedPieces[location.y] = prow;
        }
        else {
            for (var i = prow.length - 1; i >= location.x; i--) {
                var p = prow[i];
                var dest = i + numPieces;
                if (p !== undefined) {
                    p.setGridCoords(dest, location.y);
                }
                prow[dest] = p;
            }
        }
        for (var i = 0; i < numPieces; i++) {
            prow[location.x + i] = pieces[i];
        }
    };
    Grid.fixupLocations = function (location, pieces) {
        var prow = placedPieces[location.y];
        if (prow === undefined) {
            return;
        }
        for (var i = 0; i < pieces; i++) {
            var x = location.x + i;
            var p = prow[x];
            if (p !== undefined) {
                p.setGridCoords(x, location.y);
            }
        }
    };
    return Grid;
}());
var BasicPuzzlePiece = (function (_super) {
    __extends(BasicPuzzlePiece, _super);
    function BasicPuzzlePiece(canvas, previouslangid, previouslabel, args) {
        var _this = _super.call(this) || this;
        _this.canvas = canvas;
        if ('options' in args) {
            var options = args.options;
            _this.options = options;
            options || (options = {});
            options.width = piecewidth;
            options.height = pieceheight;
            var puzzleSides = options.sides || {};
            var puzzleLeft = puzzleSides.left || 0;
            var puzzleRight = puzzleSides.right || 0;
            var puzzleTop = puzzleSides.top || 0;
            var puzzleBottom = puzzleSides.bottom || 0;
            var puzzleOffsetPoint = new fabric.Point(GriddablePuzzlePiece.calcPuzzleEdgeOffset(puzzleLeft), GriddablePuzzlePiece.calcPuzzleEdgeOffset(puzzleTop));
            options.left = getSourceLeft(options.col || 0) - puzzleOffsetPoint.x;
            options.top = getSourceTop(options.row || 0) - puzzleOffsetPoint.y;
            options.hasControls = false;
            options.hasBorders = false;
            var path = new fabric.Path(getMask(1, puzzleTop, puzzleRight, puzzleBottom, puzzleLeft), options);
            // fix where the text appears
            var text = new fabric.Text(options.label, {
                fill: '#333',
                fontFamily: 'sans-serif',
                fontWeight: 'bold',
                fontSize: 15,
                left: options.left + 10 + (puzzleLeft > 0 ? 23 : 0),
                top: options.top + 10
            });
            // const bbox = text.getBoundingRect();
            var group = new fabric.Group([path, text], {
                hasControls: false,
                hasBorders: false
            });
            _this.backingObject = group;
            _this.puzzleOffset = puzzleOffsetPoint;
        }
        else {
            // steal from another puzzle
            var src = args.srcpuzzle;
            _this.options = src.options;
            _this.backingObject = src.backingObject;
            _this.puzzleOffset = src.puzzleOffset;
        }
        return _this;
    }
    BasicPuzzlePiece.prototype.isTransient = function () {
        return true;
    };
    BasicPuzzlePiece.prototype.show = function () {
        this.canvas.add(this.backingObject);
    };
    BasicPuzzlePiece.prototype.hide = function () {
        this.canvas.remove(this.backingObject);
    };
    BasicPuzzlePiece.make = function (canvas, previouslangid, previouslabel, options) {
        var p = new BasicPuzzlePiece(canvas, previouslangid, previouslabel, { options: options });
        p.associate();
        return p;
    };
    BasicPuzzlePiece.prototype.deassociate = function () {
    };
    ;
    BasicPuzzlePiece.prototype.associate = function () {
    };
    ;
    return BasicPuzzlePiece;
}(GriddablePuzzlePiece));
var InteractivePuzzlePiece = (function (_super) {
    __extends(InteractivePuzzlePiece, _super);
    function InteractivePuzzlePiece(canvas, previouslangid, previouslabel, args) {
        var _this = _super.call(this, canvas, previouslangid, previouslabel, args) || this;
        _this.mousedown = function () {
            // Update source browser to point to the IL definition -JS
            // Dealing with window focus is annoying, so disabled for now - JS
            if (_this.previouslangid != null) {
                var illoc = makeTransitionURL(_this.previouslangid, _this.previouslabel, _this.langid, _this.label);
                var win = window.open(illoc, 'codebrowser');
                window.focus();
            }
            var gp = _this.getGridPoint();
            _this.backingObject.set({
                opacity: 0.5
            });
            _this.movePlace = { left: gp.x, top: gp.y };
        };
        _this.mouseup = function () {
            _this.backingObject.set({
                opacity: 1
            });
            var gridp = _this.getGridPoint();
            var leftentry = gridp.x;
            var topentry = gridp.y;
            _this.setGridPoint(gridp);
            // fix this to use grid coordinates
            if (gridp.y < 0 || gridp.y >= gridRows) {
                Grid.remove(gridp);
                _this.hide();
            }
            delete _this.movePlace;
            // find the rightmost entry in the row
            var prow = placedPieces[topentry];
            if (prow !== undefined) {
                var maxcol = void 0;
                for (maxcol = prow.length - 1; maxcol >= 0; maxcol--) {
                    if (prow[maxcol] !== undefined) {
                        break;
                    }
                }
                ensureCanvasInteractivePieceWidth(_this.canvas, maxcol + 1);
            }
            // // update the placed grid
            // if('movePlace' in this) {
            // 	// finalize the moved pieces in their new positions
            // 	const prow = placedPieces[topentry];
            // 	if(! (prow === undefined)) {
            // 		let curleft = leftentry;
            // 		let curleftval = prow[leftentry];
            // 		while(! (curleftval === undefined)) {
            // 			let nextleft = curleft+1;
            // 			let nextleftval = prow[nextleft];
            // 			prow[nextleft] = curleftval;
            // 			curleft = nextleft;
            // 			curleftval = nextleftval;
            // 		}
            // 		ensureCanvasInteractivePieceWidth(this.canvas, curleft+1);
            // 		prow[leftentry] = undefined;
            // 	}
            // 	delete this['movePlace'];
            // }
            // if(topentry >= placedPieces.length || placedPieces[topentry] === undefined) {
            // 	placedPieces[topentry] = [];
            // }
            // const topplaces = placedPieces[topentry];
            // if(leftentry >= topplaces.length || topplaces[leftentry] === undefined) {
            // 	topplaces[leftentry] = this;
            // }
            // // finalize any left objects in their new positions
            // // remove any transient path objects
            // if('pathObjects' in this) {
            // 	for(let i =0; i < this.pathObjects.length; i++) {
            // 		const obj = this.pathObjects[i];
            // 		this.backingObject.canvas.remove(obj.backingObject);
            // 	}
            // 	delete this.pathObjects;			
            // }
        };
        _this.moving = function () {
            var oldactualleft = _this.backingObject.getLeft();
            var oldactualtop = _this.backingObject.getTop();
            var gridp = _this.getGridPoint();
            var originalleftentry = gridp.x;
            var leftentry = originalleftentry;
            var topentry = gridp.y;
            if ('movePlace' in _this) {
                if (_this.movePlace.left == leftentry && _this.movePlace.top == topentry) {
                    // still over the same grid spot
                    return;
                }
                var oldtop = _this.movePlace.top;
                var oldleft = _this.movePlace.left;
                var prow_1 = placedPieces[oldtop];
                var shifted_1 = InteractivePuzzlePiece.removeadjacentTransients({ x: oldleft, y: oldtop });
                var newleft = oldleft - shifted_1;
                Grid.remove({ x: newleft, y: oldtop });
                InteractivePuzzlePiece.addTransientsBefore({ x: newleft, y: oldtop });
            }
            // // destroy any associated objects
            // if('pathObjects' in this) {
            // 	for(let i =0; i < this.pathObjects.length; i++) {
            // 		const obj = this.pathObjects[i];
            // 		this.backingObject.canvas.remove(obj.backingObject);
            // 	}
            // 	delete this.pathObjects;			
            // }
            // update, since it may have moved when we removed/added transients 
            leftentry = _this.getGridPoint().x;
            _this.backingObject.moveCursor = 'grabbing';
            var prow = placedPieces[topentry];
            var shifted = 0;
            if (prow !== undefined) {
                var existingPiece = prow[leftentry];
                if (existingPiece !== undefined) {
                    if (existingPiece.isTransient()) {
                        shifted = InteractivePuzzlePiece.removeadjacentTransients({ x: leftentry, y: topentry });
                        leftentry = leftentry - shifted;
                        // also remove the current (transient) entry
                        Grid.removeAndHide({ x: leftentry, y: topentry });
                        //leftentry = leftentry+1;
                        Grid.add({ x: leftentry, y: topentry }, _this);
                    }
                    else {
                        Grid.add({ x: leftentry, y: topentry }, _this);
                        shifted = InteractivePuzzlePiece.removeadjacentTransients({ x: leftentry, y: topentry });
                        leftentry = leftentry - shifted;
                    }
                }
                else {
                    Grid.add({ x: leftentry, y: topentry }, _this);
                }
            }
            else {
                Grid.add({ x: leftentry, y: topentry }, _this);
            }
            var movedBack = InteractivePuzzlePiece.addTransients({ x: leftentry, y: topentry }, _this);
            leftentry = leftentry + movedBack;
            if (leftentry == originalleftentry) {
                // if this is where we started, restore the (unsnapped) coordinates
                _this.backingObject.setLeft(oldactualleft);
                _this.backingObject.setTop(oldactualtop);
            }
            else {
                _this.setGridCoords(leftentry, topentry);
            }
            _this.canvas.renderAll();
            _this.movePlace = { top: topentry, left: leftentry };
        };
        if ('srcpuzzle' in args) {
            var options = args.srcpuzzle;
            _this.langid = options.langid;
            _this.label = options.label;
            _this.langdescription = options.langdescription;
            _this.previouslangid = previouslangid;
            _this.previouslabel = previouslabel;
        }
        else {
            var options = args.options;
            _this.langid = options.langid;
            _this.label = options.label;
            _this.langdescription = options.langdescription;
            _this.previouslangid = previouslangid;
            _this.previouslabel = previouslabel;
        }
        return _this;
    }
    InteractivePuzzlePiece.prototype.isTransient = function () {
        return false;
    };
    InteractivePuzzlePiece.make = function (canvas, previouslangid, previouslabel, src) {
        var p = new InteractivePuzzlePiece(canvas, previouslangid, previouslabel, { srcpuzzle: src });
        p.associate();
        return p;
    };
    InteractivePuzzlePiece.prototype.associate = function () {
        this.backingObject.selectable = true;
        this.backingObject.hoverCursor = 'grab';
        this.backingObject.moveCursor = 'grabbing';
        this.backingObject.on('mousedown', this.mousedown);
        this.backingObject.on('moving', this.moving);
        this.backingObject.on('mouseup', this.mouseup);
    };
    InteractivePuzzlePiece.prototype.disassociate = function () {
        this.backingObject.off('mousedown', this.mousedown);
        this.backingObject.off('moving', this.moving);
        this.backingObject.off('mouseup', this.mouseup);
    };
    // TODO: would probably help to have a grid abstraction
    // which you add/move stuff with (instead of just setting/getting prow and stuff)
    // 
    /**
     * Remove any transients (transient-transitively) next to point
     */
    InteractivePuzzlePiece.removeadjacentTransients = function (point) {
        var cury = point.y;
        var prow = placedPieces[cury];
        if (prow === undefined) {
            return;
        }
        var curx = point.x + 1;
        // delete stuff to the right
        while (true) {
            var p = prow[curx];
            if (p !== undefined && p.isTransient()) {
                Grid.removeAndHide({ x: curx, y: cury });
            }
            else {
                break;
            }
        }
        // delete stuff to the left
        curx = point.x - 1;
        while (curx >= 0) {
            var p = prow[curx];
            if (p !== undefined && p.isTransient()) {
                Grid.removeAndHide({ x: curx, y: point.y });
                curx--;
            }
            else {
                break;
            }
        }
        return point.x - (curx + 1);
    };
    InteractivePuzzlePiece.addTransientsBefore = function (afterpoint) {
        var cury = afterpoint.y;
        var curx = afterpoint.x;
        var prow = placedPieces[cury];
        if (prow === undefined) {
            return 0;
        }
        var piece = prow[curx];
        if (piece === undefined) {
            return 0;
        }
        if (piece.isTransient()) {
            console.log("addTransientsBefore called next to a transient (right).  This should not happen.");
            return 0;
        }
        if (curx > 0) {
            var leftx = curx - 1;
            var leftp = prow[leftx];
            if (leftp !== undefined) {
                if (leftp.isTransient()) {
                    console.log("addTransientsBefore called next to a transient (left).  This should not happen.");
                    return 0;
                }
                var leftpieces = InteractivePuzzlePiece.getPathTransients(leftp, piece);
                if (leftpieces.length > 0) {
                    Grid.addAndShow(afterpoint, leftpieces);
                    Grid.fixupLocations(afterpoint, leftpieces.length);
                }
                return leftpieces.length;
            }
            else {
                return 0;
            }
        }
        else {
            return 0;
        }
    };
    // add transients around a piece
    InteractivePuzzlePiece.addTransients = function (curpoint, piece) {
        var cury = curpoint.y;
        var curx = curpoint.x;
        var prow = placedPieces[cury];
        if (prow === undefined) {
            return 0;
        }
        var rightx = curx + 1;
        var rightp = prow[rightx];
        if (rightp !== undefined) {
            if (rightp.isTransient()) {
                console.log("addTransient called next to a transient (right).  This should not happen.");
                return 0;
            }
            var rightpieces = InteractivePuzzlePiece.getPathTransients(piece, rightp);
            if (rightpieces.length > 0) {
                Grid.addAndShow({ y: cury, x: rightx }, rightpieces);
                // call fixup on them
                Grid.fixupLocations({ y: cury, x: rightx }, rightpieces.length);
            }
        }
        if (curx > 0) {
            var leftx = curx - 1;
            var leftp = prow[leftx];
            if (leftp !== undefined) {
                if (leftp.isTransient()) {
                    console.log("addTransient called next to a transient (left).  This should not happen.");
                    return 0;
                }
                var leftpieces = InteractivePuzzlePiece.getPathTransients(leftp, piece);
                if (leftpieces.length > 0) {
                    Grid.addAndShow(curpoint, leftpieces);
                    Grid.fixupLocations(curpoint, leftpieces.length);
                }
                return leftpieces.length;
            }
            else {
                return 0;
            }
        }
        else {
            return 0;
        }
    };
    // I need to figure out this whole interactive v transient thing better
    InteractivePuzzlePiece.getPathTransients = function (piece1, piece2) {
        var curPath = qcertLanguagesPath({
            source: piece1.langid,
            target: piece2.langid
        }).path;
        var curPathLen = curPath.length;
        var transients = [];
        if (curPath == null
            || curPathLen == 0
            || (curPathLen == 1 && curPath[0] == "error")) {
            // (<any>this.backingObject).moveCursor = 'no-drop';
            // add an error piece
            transients.push(errorPiece.mkTransientDerivative(null, null));
        }
        else {
            for (var j = 1; j < curPathLen - 1; j++) {
                var previouslangid = curPath[j - 1];
                var langid = curPath[j];
                var p = SourcePuzzlePiece.makeTransient(previouslangid, langid);
                // p.setGridCoords(leftentry+(j-1), topentry);
                // p.backingObject.top = p.backingObject.top + pieceheight/2;
                // p.backingObject.setCoords();
                transients.push(p);
                //this.backingObject.canvas.add(p.backingObject);
            }
        }
        piece2.previouslangid = transients[transients.length - 1].langid;
        piece2.previouslabel = sourcePieces[transients[transients.length - 1].langid].label;
        return transients;
    };
    return InteractivePuzzlePiece;
}(BasicPuzzlePiece));
var SourcePuzzlePiece = (function (_super) {
    __extends(SourcePuzzlePiece, _super);
    function SourcePuzzlePiece(canvas, options) {
        var _this = _super.call(this, canvas, null, null, { options: options }) || this;
        _this.mousedown = function () {
            // Update source browser to point to the IL definition -JS
            // Dealing with window focus is annoying, so disabled for now - JS
            var illoc = fixLabel(_this.label) + ".Lang." + fixLabel(_this.label);
            var langURL = makeLemmaURL(illoc, _this.langid);
            var win = window.open(langURL, 'codebrowser');
            window.focus();
            // Rest of logic for moving puzzle pieces
            _this.backingObject.set({
                opacity: .5
            });
            // clear any tooltip
            if ('tooltipObj' in _this) {
                _this.backingObject.canvas.remove(_this.tooltipObj);
                delete _this.tooltipObj;
            }
            _this.disassociate();
            InteractivePuzzlePiece.make(_this.canvas, null, null, _this);
            // This could be optimized a bit
            // in particular, we can factor out the underlying puzzle piece,
            // and just create it and give it to the existing source piece
            // instead of creating a new source piece
            var newSourcePiece = SourcePuzzlePiece.make(_this.canvas, _this.options);
            _this.backingObject.canvas.add(newSourcePiece.backingObject);
            sourcePieces[_this.langid] = newSourcePiece;
            _this.backingObject.canvas.renderAll();
        };
        _this.mouseover = function () {
            if (!('tooltipObj' in _this)) {
                var tip = makeToolTip(_this.langdescription, _this.backingObject.canvas, { left: _this.backingObject.left, top: _this.backingObject.top, width: piecewidth, height: pieceheight }, new fabric.Point(10, 10), { fill: 'black', fontSize: 20 }, { fill: '#EEEEEE' });
                _this.tooltipObj = tip;
                _this.backingObject.canvas.add(tip);
            }
        };
        _this.mouseout = function () {
            if ('tooltipObj' in _this) {
                _this.backingObject.canvas.remove(_this.tooltipObj);
                delete _this.tooltipObj;
            }
        };
        _this.langid = options.langid;
        _this.label = options.label;
        _this.langdescription = options.langdescription;
        return _this;
    }
    SourcePuzzlePiece.makeBasic = function (langid) {
        return sourcePieces[langid].mkBasicDerivative();
    };
    SourcePuzzlePiece.makeTransient = function (prevlangid, langid) {
        var prevlabel = null;
        if (prevlangid != null) {
            prevlabel = sourcePieces[prevlangid].label;
        }
        return sourcePieces[langid].mkTransientDerivative(prevlangid, prevlabel);
    };
    SourcePuzzlePiece.prototype.isTransient = function () {
        return true;
    };
    SourcePuzzlePiece.make = function (canvas, options) {
        var p = new SourcePuzzlePiece(canvas, options);
        p.associate();
        return p;
    };
    ;
    SourcePuzzlePiece.prototype.associate = function () {
        this.backingObject.hoverCursor = 'grab';
        this.backingObject.moveCursor = 'grabbing';
        this.backingObject.on('mousedown', this.mousedown);
        this.backingObject.on('mouseover', this.mouseover);
        this.backingObject.on('mouseout', this.mouseout);
    };
    ;
    SourcePuzzlePiece.prototype.disassociate = function () {
        this.backingObject.off();
        // this.backingObject.off('mousedown', this.mousedown);
        // this.backingObject.off('mouseover', this.mouseover); 
        // this.backingObject.off('mouseout', this.mouseout); 
    };
    SourcePuzzlePiece.prototype.mkBasicDerivative = function () {
        return BasicPuzzlePiece.make(this.canvas, null, null, this.options);
    };
    SourcePuzzlePiece.prototype.mkTransientDerivative = function (previouslangid, previouslabel) {
        return TransientPuzzlePiece.make(this.canvas, previouslangid, previouslabel, { options: this.options });
    };
    return SourcePuzzlePiece;
}(BasicPuzzlePiece));
var TransientPuzzlePiece = (function (_super) {
    __extends(TransientPuzzlePiece, _super);
    function TransientPuzzlePiece(canvas, previouslangid, previouslabel, args) {
        var _this = _super.call(this, canvas, previouslangid, previouslabel, args) || this;
        _this.mousedown = function () {
            // Update source browser to point to the IL definition -JS
            // Dealing with window focus is annoying, so disabled for now - JS
            if (_this.previouslangid != null) {
                var illoc = makeTransitionURL(_this.previouslangid, _this.previouslabel, _this.langid, _this.label);
                var win = window.open(illoc, 'codebrowser');
                window.focus();
            }
        };
        _this.mouseup = function () {
        };
        if ('srcpuzzle' in args) {
            var options = args.srcpuzzle;
            _this.langid = options.langid;
            _this.label = options.label;
            _this.langdescription = options.langdescription;
            _this.previouslangid = previouslangid;
            _this.previouslabel = previouslabel;
        }
        else {
            var options = args.options;
            _this.langid = options.langid;
            _this.label = options.label;
            _this.langdescription = options.langdescription;
            _this.previouslangid = previouslangid;
            _this.previouslabel = previouslabel;
        }
        return _this;
    }
    TransientPuzzlePiece.prototype.isTransient = function () {
        return true;
    };
    TransientPuzzlePiece.make = function (canvas, previouslangid, previouslabel, args) {
        var p = new TransientPuzzlePiece(canvas, previouslangid, previouslabel, args);
        p.associate();
        return p;
    };
    TransientPuzzlePiece.prototype.associate = function () {
        this.oldoptions = {
            selectable: this.backingObject.selectable,
            opacity: this.backingObject.getOpacity()
        };
        this.backingObject.selectable = false;
        this.backingObject.setOpacity(0.25);
        this.backingObject.hoverCursor = 'pointer';
        this.backingObject.moveCursor = 'pointer';
        this.backingObject.on('mousedown', this.mousedown);
        //this.backingObject.on('moving', this.moving); 
        this.backingObject.on('mouseup', this.mouseup);
    };
    TransientPuzzlePiece.prototype.disassociate = function () {
        if ('oldoptions' in this) {
            this.backingObject.set(this.oldoptions);
            delete this.oldoptions;
        }
        this.backingObject.off('mousedown', this.mousedown);
        //this.backingObject.off('moving', this.moving); 
        this.backingObject.off('mouseup', this.mouseup);
    };
    return TransientPuzzlePiece;
}(BasicPuzzlePiece));
// hm.  it would be really nice if we could make shorter pieces...
// a makeCompositePiece which takes in a list of puzzle pieces
// (which it can, of course, display as the hovertip.  Ideally it would take color from them too...)
// yay! the new getLRMask can do this!
// TODO: first get the implicit logic to work:
// when we need a new piece, create one piece (with first part of the chain?) and mark it implicit
// make sure all the logic works.
// after implicit pieces work, add support for composite pieces (which may also be implicit)
// TODO: create a makeCompositePiece that takes in a bunch of IPuzzlePieces
// and creates a single composite piece that can show the originals in a tooltip
// depending on which piece part you are actually hovering over, the tooltip will
// show that piece "bright"/selected and the others with a lower opacity
// separately, mark pieces as implicit if they are implicit
// If there is a single piece in a chain, it can be directly added (marked as implicit)
// if more, they are created, and then a composite (and implicit) chain will represent them.
// double clicking (if we can support that) on an implicit (either normal or composite)
// turns it into an explicit chain
// dropping on an implicit is allowed.  It does not make the implicit move out of the way,
// although it may generate a (possibly temporary) new implicit
// the logic will be a bit hairy :-)
// Of course, that piece will be marked as "generated"
// which means that 
// the sources that are passed in are owned (and manipulated directly) by the resulting composite object
var CompositePuzzlePiece = (function (_super) {
    __extends(CompositePuzzlePiece, _super);
    function CompositePuzzlePiece(canvas, sources) {
        var _this = _super.call(this) || this;
        _this.mousemovehandler = function (e) {
            if (e.target == _this.backingObject) {
                if (!('tooltipObj' in _this)) {
                    _this.updateTooltip();
                }
                _this.updateTooltipFocus(e.e);
            }
        };
        _this.mouseover = function () {
            _this.canvas.on('mouse:move', _this.mousemovehandler);
        };
        _this.mouseout = function () {
            _this.canvas.off('mouse:move', _this.mousemovehandler);
            _this.deleteTooltip();
        };
        _this.moving = function () {
            _this.updateTooltip();
        };
        _this.puzzleOffset = new fabric.Point(GriddablePuzzlePiece.calcPuzzleEdgeOffset(1), 0);
        _this.canvas = canvas;
        _this.sources = sources;
        var sourceLen = sources.length;
        var pwidth = piecewidth / sourceLen;
        var parts = [];
        var fulls = [];
        for (var i = 0; i < sourceLen; i++) {
            var p = sources[i];
            var ofull = p.backingObject;
            var shortPiece = new fabric.Path(CompositePuzzlePiece.getLRMask(1, 1, -1, pwidth), {
                fill: p.backingObject.fill,
                opacity: 0.5,
                left: i * pwidth,
                top: 0,
            });
            shortPiece.set({
                fill: '#6699ff',
                hasControls: false,
                selectable: false,
                evented: false,
            });
            ofull.setOpacity(p.backingObject.opacity / 2);
            p.setGridCoords(i, 0);
            shortPiece.fullPiece = p;
            parts.push(shortPiece);
            fulls.push(ofull);
        }
        _this.fullGroup = new fabric.Group(fulls);
        _this.backingObject = new fabric.Group(parts);
        _this.parts = parts;
        _this.lastSelectedPart = -1;
        return _this;
    }
    CompositePuzzlePiece.getLRMask = function (tileRatio, rightTab, leftTab, width) {
        var curvyCoords = [0, 0, 35, 15, 37, 5, 37, 5, 40, 0, 38, -5, 38, -5,
            20, -20, 50, -20, 50, -20, 80, -20, 62, -5, 62, -5, 60, 0, 63,
            5, 63, 5, 65, 15, 100, 0];
        var tileHeight = 100;
        var mask = "";
        var leftx = -4;
        var topy = 0;
        var rightx = leftx + width;
        var bottomy = topy + tileHeight;
        mask += "M" + leftx + "," + topy;
        mask += "L" + (leftx + width) + "," + topy;
        //Right
        for (var i = 0; i < curvyCoords.length / 6; i++) {
            mask += "C";
            mask += rightx - rightTab * curvyCoords[i * 6 + 1] * tileRatio;
            mask += ",";
            mask += topy + curvyCoords[i * 6 + 0] * tileRatio;
            mask += ",";
            mask += rightx - rightTab * curvyCoords[i * 6 + 3] * tileRatio;
            mask += ",";
            mask += topy + curvyCoords[i * 6 + 2] * tileRatio;
            mask += ",";
            mask += rightx - rightTab * curvyCoords[i * 6 + 5] * tileRatio;
            mask += ",";
            mask += topy + curvyCoords[i * 6 + 4] * tileRatio;
        }
        mask += "L" + leftx + "," + bottomy;
        //Left
        for (var i = 0; i < curvyCoords.length / 6; i++) {
            mask += "C";
            mask += leftx + leftTab * curvyCoords[i * 6 + 1] * tileRatio;
            mask += ",";
            mask += bottomy - curvyCoords[i * 6 + 0] * tileRatio;
            mask += ",";
            mask += leftx + leftTab * curvyCoords[i * 6 + 3] * tileRatio;
            mask += ",";
            mask += bottomy - curvyCoords[i * 6 + 2] * tileRatio;
            mask += ",";
            mask += leftx + leftTab * curvyCoords[i * 6 + 5] * tileRatio;
            mask += ",";
            mask += bottomy - curvyCoords[i * 6 + 4] * tileRatio;
        }
        return mask;
    };
    CompositePuzzlePiece.prototype.isTransient = function () {
        return false;
    };
    CompositePuzzlePiece.make = function (canvas, gridx, gridy, sources) {
        var piece = new CompositePuzzlePiece(canvas, sources);
        piece.associate();
        piece.setGridCoords(gridx, gridy);
        return piece;
    };
    CompositePuzzlePiece.prototype.show = function () {
        this.canvas.add(this.backingObject);
    };
    CompositePuzzlePiece.prototype.hide = function () {
        this.canvas.remove(this.backingObject);
    };
    CompositePuzzlePiece.prototype.updateTooltip = function () {
        // abstract the logic from makeToolTip?
        // fix where it appears!
        var tipbound = this.fullGroup.getBoundingRect();
        var compositebound = this.backingObject.getBoundingRect();
        this.fullGroup.setLeft(compositebound.left + (compositebound.width - tipbound.width) / 2);
        this.fullGroup.setTop(compositebound.top + compositebound.height + 10);
        var tip = this.fullGroup;
        if (!('tooltipObj' in this)) {
            this.tooltipObj = tip;
            this.canvas.add(tip);
        }
    };
    ;
    CompositePuzzlePiece.prototype.findSubTarget = function (e, lastIndex) {
        var mousePos = this.canvas.getPointer(e);
        var mousePoint = new fabric.Point(mousePos.x, mousePos.y);
        if (lastIndex >= 0) {
            var part = this.parts[lastIndex];
            if (part.containsInGroupPoint(mousePoint)) {
                return lastIndex;
            }
        }
        for (var i = 0; i < this.parts.length; i++) {
            if (i == lastIndex) {
                continue;
            }
            var part = this.parts[i];
            if (part.containsInGroupPoint(mousePoint)) {
                return i;
            }
        }
        return -1;
    };
    CompositePuzzlePiece.prototype.updateTooltipFocus = function (e) {
        var newSelectedPart = this.findSubTarget(e, this.lastSelectedPart);
        if (this.lastSelectedPart == newSelectedPart) {
            return;
        }
        if (this.lastSelectedPart >= 0) {
            var lastpartpiece = this.parts[this.lastSelectedPart];
            //lastpart.makeUnselected();
        }
        if (newSelectedPart >= 0) {
            var newpart = this.sources[newSelectedPart];
            //newpart.makeSelected();
        }
        this.lastSelectedPart = newSelectedPart;
        this.canvas.renderAll();
    };
    CompositePuzzlePiece.prototype.deleteTooltip = function () {
        if ('tooltipObj' in this) {
            this.canvas.remove(this.tooltipObj);
            delete this.tooltipObj;
        }
    };
    CompositePuzzlePiece.prototype.associate = function () {
        this.backingObject.on('mouseover', this.mouseover);
        this.backingObject.on('mouseout', this.mouseout);
        this.backingObject.on('moving', this.moving);
    };
    CompositePuzzlePiece.prototype.deassociate = function () {
        this.backingObject.off('mouseover', this.mouseover);
        this.backingObject.off('mouseout', this.mouseout);
        this.backingObject.off('moving', this.moving);
    };
    return CompositePuzzlePiece;
}(GriddablePuzzlePiece));
function getLangPiece(langid) {
    return SourcePuzzlePiece.makeBasic(langid);
}
var defaultTabTextOpts = {
    fontFamily: 'sans-serif',
};
var defaultTabRectOpts = {
    cornerSize: 2,
    strokeLineCap: 'round'
};
var ICanvasTab = (function () {
    function ICanvasTab(canvas) {
        this.canvas = canvas;
    }
    ICanvasTab.prototype.getRectOptions = function () {
        return defaultTabRectOpts;
    };
    ICanvasTab.prototype.getTextOptions = function () {
        return defaultTabTextOpts;
    };
    ICanvasTab.prototype.hide = function () {
        this.canvas.clear();
    };
    return ICanvasTab;
}());
var ICanvasDynamicTab = (function (_super) {
    __extends(ICanvasDynamicTab, _super);
    function ICanvasDynamicTab(canvas) {
        return _super.call(this, canvas) || this;
    }
    return ICanvasDynamicTab;
}(ICanvasTab));
var TabManager = (function (_super) {
    __extends(TabManager, _super);
    function TabManager(canvas, options, tabs) {
        var _this = _super.call(this, canvas) || this;
        _this.currentTab = null;
        _this.label = options.label;
        _this.rectOpts = options.rectOptions || defaultTabRectOpts;
        _this.textOpts = options.textOptions || defaultTabTextOpts;
        _this.tabObjects = [];
        var defaultTabOrigin = { left: 10, top: 5 };
        var tabOrigin = options.tabOrigin || defaultTabOrigin;
        var tabTop = tabOrigin.top || defaultTabOrigin.top;
        var tabLeft = tabOrigin.left || defaultTabOrigin.left;
        var _loop_1 = function (i) {
            var itab = tabs[i];
            var tabgroup = TabManager.makeTab(itab, tabTop, tabLeft);
            tabLeft += tabgroup.getBoundingRect().width;
            tabgroup.hoverCursor = 'pointer';
            tabgroup.on('selected', function () {
                _this.switchTab(itab);
            });
            this_1.tabObjects.push(tabgroup);
        };
        var this_1 = this;
        for (var i = 0; i < tabs.length; i++) {
            _loop_1(i);
        }
        return _this;
    }
    TabManager.makeTab = function (tab, top, left) {
        var ropts = fabric.util.object.clone(defaultTabRectOpts);
        fabric.util.object.extend(ropts, tab.getRectOptions() || {});
        ropts.left = left;
        ropts.top = top;
        ropts.editable = false;
        ropts.height = ropts.height || 30;
        ropts.width = ropts.width || 150;
        var box = new fabric.Rect(ropts);
        var topts = fabric.util.object.clone(defaultTabTextOpts);
        fabric.util.object.extend(topts, tab.getTextOptions() || {});
        topts.left = 0;
        topts.top = 0;
        topts.editable = false;
        var text = new fabric.IText(tab.getLabel(), topts);
        // calculate where it should appear.
        // if needed, shrink the font so that the text
        // is not too large
        var boundingBox = text.getBoundingRect();
        var maxwidth = ropts.width - 4;
        while (boundingBox.width > maxwidth) {
            text.setFontSize(text.getFontSize() - 2);
            text.setCoords();
            boundingBox = text.getBoundingRect();
        }
        text.originX = 'left';
        text.left = ropts.left + (ropts.width - boundingBox.width) / 2;
        text.originY = 'top';
        text.top = ropts.top;
        text.height = ropts.height;
        text.width = ropts.width;
        text.setTextAlign('center');
        text.setCoords();
        var group = new fabric.Group([box, text]);
        group.hasControls = false;
        group.hasBorders = false;
        group.lockMovementX = true;
        group.lockMovementY = true;
        tab.canvasObj = group;
        group.setOpacity(0.3);
        return group;
    };
    TabManager.make = function (canvas, options, tabs, startTab) {
        if (startTab === void 0) { startTab = -1; }
        console.log("Making tab manager with label " + options.label + " and initial tab " + startTab + " and " + tabs.length + " tabs");
        var tm = new TabManager(canvas, options, tabs);
        tm.setInitTab(tabs, startTab);
        return tm;
    };
    TabManager.prototype.setInitTab = function (tabs, startTab) {
        if (startTab >= 0 && startTab < tabs.length) {
            var t = tabs[startTab];
            if (t !== undefined && t !== null) {
                this.currentTab = t;
                if ('canvasObj' in t) {
                    var tabobj = t.canvasObj;
                    tabobj.setOpacity(1);
                }
            }
        }
    };
    TabManager.prototype.replaceTab = function (newTab, position) {
        var _this = this;
        var oldGroup = this.tabObjects[position];
        var rect = oldGroup.getBoundingRect();
        console.log("Old tab:");
        console.log(this.currentTab);
        var newGroup = TabManager.makeTab(newTab, rect.top, rect.left);
        newGroup.hoverCursor = 'pointer';
        newGroup.on('selected', function () {
            _this.switchTab(newTab);
        });
        this.tabObjects.forEach(function (obj) { return _this.canvas.remove(obj); });
        this.tabObjects[position] = newGroup;
        this.tabObjects.forEach(function (obj) { return _this.canvas.add(obj); });
        if (oldGroup === this.currentTab.canvasObj) {
            this.switchTab(newTab);
        }
        console.log("New tab:");
        console.log(newTab);
        this.canvas.renderAll();
    };
    TabManager.prototype.getLabel = function () {
        return this.label;
    };
    TabManager.prototype.getRectOptions = function () {
        return this.rectOpts;
    };
    TabManager.prototype.getTextOptions = function () {
        return this.textOpts;
    };
    TabManager.prototype.show = function () {
        var _this = this;
        if (this.currentTab != null) {
            this.currentTab.show();
        }
        this.tabObjects.forEach(function (obj) { return _this.canvas.add(obj); });
    };
    TabManager.prototype.hide = function () {
        var _this = this;
        if (this.currentTab != null) {
            this.currentTab.hide();
        }
        this.tabObjects.forEach(function (obj) { return _this.canvas.remove(obj); });
    };
    TabManager.prototype.switchTab = function (tab) {
        if (this.currentTab != null) {
            if ('canvasObj' in this.currentTab) {
                var tabobj = this.currentTab.canvasObj;
                tabobj.setOpacity(0.3);
            }
            this.currentTab.hide();
        }
        this.currentTab = tab;
        tab.show();
        if ('canvasObj' in tab) {
            var tabobj = tab.canvasObj;
            tabobj.setOpacity(1);
        }
    };
    return TabManager;
}(ICanvasTab));
var BuilderTab = (function (_super) {
    __extends(BuilderTab, _super);
    function BuilderTab(canvas) {
        var _this = _super.call(this, canvas) || this;
        separatorLine.set('visible', true);
        var startPiece = BasicPuzzlePiece.make(canvas, null, null, {
            fill: '#bfe49a',
            label: 'start',
            sides: { right: -1 },
            hasControls: false,
            selectable: false,
            evented: false
        });
        startPiece.setGridCoords(0, pipelineRow);
        startPiece.backingObject.set({
            hasControls: false,
            selectable: false
        });
        startPiece.backingObject.hoverCursor = 'auto';
        _this.startPiece = startPiece;
        var runText = new fabric.Text('R\nu\nn', {
            left: 2,
            fontSize: 25,
            top: pipelineRow * pieceheight + gridOffset.y + 1,
            textAlign: 'center',
            width: 20,
            fill: 'red',
            height: pieceheight
        });
        var runRect = new fabric.Rect({
            left: 0,
            top: pipelineRow * pieceheight + gridOffset.y,
            width: 20,
            height: pieceheight - 2,
            stroke: 'red',
            strokeWidth: 2
        });
        var runGroup = new fabric.Group([runRect, runText]);
        runGroup.set({
            hasControls: false,
            selectable: false
        });
        runGroup.on('mouseover', function () {
            if (!('tooltipObj' in runGroup)) {
                // TODO: add path information here (at least for now)
                var tip = makeToolTip("Run the compiler!", canvas, { left: runGroup.left, top: runGroup.top, width: 20, height: pieceheight }, new fabric.Point(10, 10), { fill: 'black', fontSize: 40 }, { fill: '#EEEEEE' });
                runGroup.tooltipObj = tip;
                runGroup.canvas.add(tip);
            }
        });
        runGroup.on('mouseout', function () {
            if ('tooltipObj' in runGroup) {
                canvas.remove(runGroup.tooltipObj);
                delete runGroup.tooltipObj;
            }
        });
        var srcLangDescripts = getSrcLangDescripts(qcertLanguages());
        var maxCols = 0;
        // create the list of languages that can be dragged onto the canvas
        var srcrow = 0;
        for (srcrow = 0; srcrow < srcLangDescripts.length; srcrow++) {
            var rowelem = srcLangDescripts[srcrow];
            if (rowelem == null) {
                continue;
            }
            var srccol = 0;
            for (srccol = 0; srccol < rowelem.length; srccol++) {
                var colelem = rowelem[srccol];
                if (colelem == null) {
                    continue;
                }
                colelem.row = srcrow;
                colelem.col = srccol;
                var piece = SourcePuzzlePiece.make(canvas, colelem);
                sourcePieces[colelem.langid] = piece;
            }
            maxCols = Math.max(srccol, maxCols);
        }
        var errorOptions = {
            langid: 'error',
            label: 'Error',
            langdescription: 'This represents an error, probably an unsupported path',
            fill: '#ff3300', sides: {}
        };
        errorPiece = SourcePuzzlePiece.make(canvas, errorOptions);
        var canvasHeightChooser = srcrow;
        _this.maxCols = maxCols;
        _this.totalCanvasHeight = getSourceTop(srcrow) - 15;
        return _this;
        //const canvasElement = document.getElementById('main-canvas');
    }
    BuilderTab.make = function (canvas) {
        return new BuilderTab(canvas);
    };
    BuilderTab.prototype.getLabel = function () {
        return "Path Builder ";
    };
    BuilderTab.prototype.getRectOptions = function () {
        return { fill: '#FEBF01' };
    };
    BuilderTab.prototype.show = function () {
        // TODO: at some point enable this
        // but upon creation remove any inappropriate (source) elements
        // and set up the mouse up/down/hover code
        // taking care that the algorithm may now need to move things multiple spaces
        // canvas.on('selection:created', function (event) {
        // 	canvas.getActiveGroup().set({hasControls : false});
        // });
        // canvas.on('object:moving', function (event) {
        // 	const piece = event.target;
        // 	piece.set({
        // 	left: Math.round(piece.left / piecewidth) * piecewidth,
        // 	top: Math.round(piece.top / pieceheight) * pieceheight
        // 	});
        // });
        // disable group selection
        //canvas.selection = false;
        // create the start piece
        // note that the start piece is meant to have a "real" piece put on top of it by the user
        var canvas = this.canvas;
        canvas.selection = false;
        canvas.hoverCursor = 'pointer';
        this.startPiece.show();
        //canvas.add(runGroup);
        canvas.add(separatorLine);
        // add the source pieces
        for (var piece in sourcePieces) {
            sourcePieces[piece].show();
        }
        // add the grid pieces
        var placedRows = placedPieces.length;
        for (var row = 0; row < placedRows; row++) {
            var prow = placedPieces[row];
            if (prow !== undefined) {
                var placedCols = prow.length;
                for (var col = 0; col < placedCols; col++) {
                    var piece = prow[col];
                    if (piece !== undefined) {
                        piece.show();
                    }
                }
            }
        }
        // make sure the canvas is wide enough
        ensureCanvasSourcePieceWidth(canvas, this.maxCols);
        // TODO: also make sure that it is wide enough for the pieces in the grid
        canvas.setHeight(this.totalCanvasHeight);
        // TODO experimental
        // const g = CompositePuzzlePiece.make(canvas, 1, 1, 
        // 	[getLangPiece("nraenv"),
        // 	getLangPiece("nra"), 
        // 	getLangPiece("camp")]);
        // g.show();
        // TODO end:experimental
        canvas.renderAll();
    };
    return BuilderTab;
}(ICanvasTab));
var CompileTab = (function (_super) {
    __extends(CompileTab, _super);
    function CompileTab(canvas) {
        var _this = _super.call(this, canvas) || this;
        _this.inputTabElement = document.getElementById("compile-tab");
        _this.titleTextElement = document.getElementById("compile-tab-lang-title");
        _this.defaultTitleTextElement = _this.titleTextElement.cloneNode(true);
        _this.queryInput = document.getElementById("compile-tab-query-input");
        _this.queryChooser = document.getElementById("compile-tab-query-src-file");
        _this.schemaChooser = document.getElementById("compile-tab-query-schema-file");
        return _this;
    }
    CompileTab.make = function (canvas) {
        return new CompileTab(canvas);
    };
    CompileTab.prototype.getLabel = function () {
        return "Compilation ";
    };
    CompileTab.prototype.getRectOptions = function () {
        return { fill: '#FEBF01' };
    };
    CompileTab.getSrcLanguagePiece = function () {
        var pipeline = getPipelinePieces();
        if (pipeline === undefined || pipeline.length == 0) {
            return errorPiece;
        }
        else {
            return pipeline[0];
        }
    };
    CompileTab.prototype.clearTitle = function () {
        while (this.titleTextElement.hasChildNodes()) {
            this.titleTextElement.removeChild(this.titleTextElement.firstChild);
        }
    };
    CompileTab.prototype.setErrorTitleText = function () {
        var newNode = this.defaultTitleTextElement.cloneNode(true);
        this.titleTextElement.parentNode.replaceChild(newNode, this.titleTextElement);
        this.titleTextElement = newNode;
    };
    CompileTab.prototype.setSrcLanguage = function (piece) {
        this.clearTitle();
        var titleElem = document.createElement('label');
        titleElem.appendChild(document.createTextNode("Input Language: " + piece.langid + " [" + piece.langdescription + "]"));
        this.titleTextElement.appendChild(titleElem);
        var langInfo = getSourceLanguageExtraInfo(piece.langid);
        this.queryChooser.accept = langInfo.accept;
        // the following is static for now but set here since it may become dynamic in the future
        this.schemaChooser.accept = schemaAccept;
    };
    CompileTab.prototype.update = function () {
        var srcpiece = CompileTab.getSrcLanguagePiece();
        if (srcpiece.langid == 'error') {
            this.setErrorTitleText();
            this.queryInput.style.display = "none";
        }
        else {
            this.setSrcLanguage(srcpiece);
            this.queryInput.style.display = "block";
        }
    };
    CompileTab.prototype.show = function () {
        this.clearTitle();
        this.update();
        this.inputTabElement.style.display = "block";
        this.canvas.getElement().style.display = "none";
    };
    CompileTab.prototype.hide = function () {
        this.canvas.getElement().style.display = "block";
        this.inputTabElement.style.display = "none";
    };
    return CompileTab;
}(ICanvasTab));
var ExecTab = (function (_super) {
    __extends(ExecTab, _super);
    function ExecTab(canvas) {
        var _this = _super.call(this, canvas) || this;
        _this.inputTabElement = document.getElementById("execute-tab");
        _this.titleTextElement = document.getElementById("execute-tab-lang-title");
        _this.defaultTitleTextElement = _this.titleTextElement.cloneNode(true);
        _this.dataInput = document.getElementById("execute-tab-query-input");
        _this.dataChooser = document.getElementById("execute-tab-query-io-file");
        return _this;
    }
    ExecTab.make = function (canvas) {
        return new ExecTab(canvas);
    };
    ExecTab.prototype.getLabel = function () {
        return " Evaluation ";
    };
    ExecTab.prototype.getRectOptions = function () {
        return { fill: '#FEBF01' };
    };
    ExecTab.getSrcLanguagePiece = function () {
        var pipeline = getPipelinePieces();
        if (pipeline === undefined || pipeline.length == 0) {
            return errorPiece;
        }
        else {
            return pipeline[0];
        }
    };
    ExecTab.prototype.clearTitle = function () {
        while (this.titleTextElement.hasChildNodes()) {
            this.titleTextElement.removeChild(this.titleTextElement.firstChild);
        }
    };
    ExecTab.prototype.setErrorTitleText = function () {
        var newNode = this.defaultTitleTextElement.cloneNode(true);
        this.titleTextElement.parentNode.replaceChild(newNode, this.titleTextElement);
        this.titleTextElement = newNode;
    };
    ExecTab.prototype.setSrcLanguage = function (piece) {
        this.clearTitle();
        var titleElem = document.createElement('label');
        titleElem.appendChild(document.createTextNode("Input Language: " + piece.langid + " [" + piece.langdescription + "]"));
        this.titleTextElement.appendChild(titleElem);
        // the following is static for now but set here since it may become dynamic in the future
        this.dataChooser.accept = dataAccept;
    };
    ExecTab.prototype.update = function () {
        var srcpiece = CompileTab.getSrcLanguagePiece();
        if (srcpiece.langid == 'error') {
            this.setErrorTitleText();
            this.dataInput.style.display = "none";
        }
        else {
            this.setSrcLanguage(srcpiece);
            this.dataInput.style.display = "block";
        }
    };
    ExecTab.prototype.show = function () {
        this.clearTitle();
        this.update();
        this.inputTabElement.style.display = "block";
        this.canvas.getElement().style.display = "none";
    };
    ExecTab.prototype.hide = function () {
        this.canvas.getElement().style.display = "block";
        this.inputTabElement.style.display = "none";
    };
    return ExecTab;
}(ICanvasTab));
function getPipelinePieces() {
    var prow = placedPieces[pipelineRow];
    var path = [];
    if (prow === undefined) {
        return path;
    }
    var rowLen = prow.length;
    for (var col = 0; col < rowLen; col++) {
        var piece = prow[col];
        if (piece === undefined) {
            return path;
        }
        path.push(piece);
    }
    return path;
}
function getPipelineLangs() {
    return getPipelinePieces().map(function (piece) {
        if ('langid' in piece) {
            return { id: piece.langid, explicit: !piece.isTransient() };
        }
        else {
            return undefined;
        }
    });
}
// function expandLangsPath(path:QcertLanguage[]):{id:QcertLanguage,explicit:boolean}[] {
// 	let expanded = [];
// 	const pathLen = path.length;
// 	if(path == null || pathLen == 0) {
// 		return expanded;
// 	}
// 	let prev = path[0];
// 	expanded.push({id:prev, explicit:true});
// 	for(let i = 1; i < pathLen; i++) {
// 		const cur = path[i];
// 		const curPath = qcertLanguagesPath({
// 			source: prev,
// 			target:cur
// 		}).path;
// 		const curPathLen = curPath.length;
// 		if(curPath == null 
// 		|| curPathLen == 0
// 		|| (curPathLen == 1 && curPath[0] == "error")) {
// 			expanded.push("error");
// 		} else {
// 			for(let j = 1; j < curPathLen; j++) {
// 				expanded.push({id:curPath[j], explicit:(j+1)==curPathLen});
// 			}
// 		}
// 		prev = cur;
// 	}
// 	return expanded;
// }
function getLanguageMarkedLabel(langpack) {
    var lang = langpack.id;
    var str = "";
    if (lang in sourcePieces) {
        str = sourcePieces[lang].label;
    }
    else {
        str = "error";
    }
    if (!langpack.explicit) {
        str = "[" + str + "]";
    }
    return str;
}
//const coqdocBaseURL = 'https://querycert.github.io/doc/';
//const coqdocBaseURL = '../..//querycert.github.io/doc/';
var coqdocBaseURL = '../doc/html/';
function makeLemmaURL(base, lemma) {
    var url = coqdocBaseURL + "Qcert." + base + ".html";
    //let url = coqdocBaseURL + base + ".html";
    if (lemma != undefined) {
        url = url + "#" + lemma;
    }
    return url;
}
function fixLabel(label) {
    if (label == "SQL++")
        return "SQLPP";
    if (label == "NRAᵉ")
        return "NRAEnv";
    if (label == "cNRAᵉ")
        return "cNRAEnv";
    if (label == "λNRA")
        return "LambdaNRA";
    return label;
}
function makeTransitionURL(previouslangid, previouslabel, langid, label) {
    var label = fixLabel(label);
    var previouslabel = fixLabel(previouslabel);
    if (previouslangid == langid) {
        return makeLemmaURL(label + ".Optim." + label + "Optimizer", "run_" + langid + "_optims");
        //return makeLemmaURL(label+"Optimizer","run_"+langid + "_optims");
    }
    else {
        return makeLemmaURL("Translation." + previouslabel + "to" + label, previouslangid + "_to_" + langid + "_top");
        //return makeLemmaURL(previouslabel+"to"+label,previouslangid + "_to_" + langid + "_top");
    }
}
function makeOptimElement(modulebase, o) {
    var entry = document.createElement('li');
    entry.classList.add("optim-list");
    entry.appendChild(document.createTextNode(o.name));
    var lemmaLink = document.createElement('a');
    lemmaLink.href = makeLemmaURL(modulebase, o.lemma);
    lemmaLink.appendChild(document.createTextNode('✿'));
    lemmaLink.classList.add('lemma-link');
    lemmaLink.setAttribute('target', 'codebrowser');
    entry.appendChild(lemmaLink);
    entry.title = o.description;
    entry.setAttribute('data-id', o.name);
    return entry;
}
function makeAvailableOptimElement(modulebase, o) {
    return makeOptimElement(modulebase, o);
}
function addRemoveButton(elem) {
    if (elem.innerText === optPlaceholder)
        return;
    var removenode = document.createElement('i');
    removenode.classList.add('js-remove');
    removenode.appendChild(document.createTextNode('✖'));
    elem.appendChild(removenode);
}
function makeSimpleOptimElement(optim) {
    var entry = document.createElement('li');
    entry.classList.add('optim-list');
    entry.appendChild(document.createTextNode(optim));
    entry.setAttribute('data-id', optim);
    return entry;
}
function makePhaseOptimElement(modulebase, optims, optim) {
    var fulloptim = findFirstWithField(optims, 'name', optim);
    var entry = fulloptim ? makeOptimElement(modulebase, fulloptim) : makeSimpleOptimElement(optim);
    addRemoveButton(entry);
    return entry;
}
function getCountWithUpdate(listnode) {
    var count = listnode.childElementCount;
    if (count == 1 && listnode.children.item(0).innerHTML == optPlaceholder)
        return 0;
    if (count == 0) {
        listnode.appendChild(makeSimpleOptimElement(optPlaceholder));
        return 0;
    }
    if (count > 1)
        for (var i = 0; i < count; i++) {
            if (listnode.children.item(i).innerHTML == optPlaceholder) {
                listnode.removeChild(listnode.children.item(i));
                return count - 1;
            }
        }
    return count;
}
var OptimPhaseTab = (function (_super) {
    __extends(OptimPhaseTab, _super);
    function OptimPhaseTab(canvas, div, modulebase, optims, phase, options) {
        var _this = _super.call(this, canvas) || this;
        _this.name = phase.name;
        _this.iter = phase.iter;
        _this.top = options.top || 0;
        _this.color = options.color || '#FEBF01';
        //this.body = document.getElementsByTagName("body")[0];
        _this.parentDiv = div;
        var newdiv = document.createElement('div');
        _this.optimDiv = newdiv;
        var divTitle = document.createElement('h3');
        divTitle.style.cssFloat = 'center';
        var titlenodetext = function (num) { return "Currently selected optimizations (" + num + ")"; };
        var displayedCount = phase.optims.length;
        if (displayedCount == 0)
            phase.optims = [optPlaceholder];
        else if (displayedCount == 1 && phase.optims[0] == optPlaceholder)
            displayedCount = 0;
        var titlenode = document.createTextNode(titlenodetext(displayedCount));
        divTitle.appendChild(titlenode);
        newdiv.appendChild(divTitle);
        var divIterations = document.createElement('h4');
        divIterations.appendChild(document.createTextNode("These optimizations will be batched in " + phase.iter + " iterations "));
        newdiv.appendChild(divIterations);
        var listnode = document.createElement('ul');
        listnode.classList.add('optim-list');
        for (var i = 0; i < phase.optims.length; i++) {
            listnode.appendChild(makePhaseOptimElement(modulebase, optims, phase.optims[i]));
        }
        function updateListAndTitleContent() {
            var elemCount = getCountWithUpdate(listnode);
            titlenode.textContent = titlenodetext(elemCount);
        }
        var sort = Sortable.create(listnode, {
            group: {
                name: 'optims',
                pull: true,
                put: true
            },
            sort: true,
            animation: 150,
            //handle: '.optim-handle',
            filter: '.js-remove',
            onFilter: function (evt) {
                var el = sort.closest(evt.item); // get dragged item
                el && el.parentNode.removeChild(el);
                updateListAndTitleContent();
            },
            onAdd: function (evt) {
                var item = evt.item;
                addRemoveButton(item);
            },
            onSort: function (evt) {
                updateListAndTitleContent();
            },
            dataIdAttr: 'data-id'
        });
        _this.sortable = sort;
        newdiv.appendChild(listnode);
        return _this;
    }
    OptimPhaseTab.make = function (canvas, parentDiv, modulebase, optims, phase, options) {
        return new OptimPhaseTab(canvas, parentDiv, modulebase, optims, phase, options);
    };
    OptimPhaseTab.prototype.getPhase = function () {
        var optims = this.sortable.toArray();
        console.log(optims);
        if (optims.length == 1 && optims[0] == optPlaceholder)
            optims = [];
        return {
            name: this.name,
            optims: optims,
            iter: this.iter
        };
    };
    OptimPhaseTab.prototype.getLabel = function () {
        return this.name;
    };
    OptimPhaseTab.prototype.setLabel = function (newlabel) {
        this.name = newlabel;
        return true;
    };
    OptimPhaseTab.prototype.getRectOptions = function () {
        return { fill: this.color };
    };
    OptimPhaseTab.prototype.show = function () {
        this.parentDiv.appendChild(this.optimDiv);
        //this.canvas.add(this.rect);
    };
    OptimPhaseTab.prototype.hide = function () {
        this.parentDiv.removeChild(this.optimDiv);
        //this.canvas.remove(this.rect);
    };
    return OptimPhaseTab;
}(ICanvasDynamicTab));
function optimPhaseMake(canvas, div, module_base, optims, options) {
    return function (phase) {
        return OptimPhaseTab.make(canvas, div, module_base, optims, phase, options);
    };
}
var OptimizationManager = (function (_super) {
    __extends(OptimizationManager, _super);
    function OptimizationManager(canvas, options, language, module_base, optims, cfg_phases) {
        var _this = _super.call(this, canvas) || this;
        _this.language = language;
        _this.rectOptions = options.rectOptions;
        _this.textOptions = options.textOptions;
        var defaultTabOrigin = { left: 10, top: 5 };
        var tabOrigin = options.tabOrigin || defaultTabOrigin;
        var tabTop = tabOrigin.top || defaultTabOrigin.top;
        var tabLeft = tabOrigin.left || defaultTabOrigin.left;
        _this.parentDiv = document.getElementById("container");
        var newdiv = document.createElement('div');
        newdiv.style.position = 'absolute';
        newdiv.style.left = '10px';
        newdiv.style.top = String(tabTop + 60) + 'px';
        _this.topDiv = newdiv;
        var listnode = document.createElement('ul');
        listnode.classList.add('optim-list');
        for (var i = 0; i < optims.length; i++) {
            var o = optims[i];
            var entry = makeAvailableOptimElement(module_base, o);
            listnode.appendChild(entry);
        }
        var leftdiv = document.createElement('div');
        leftdiv.classList.add('phase-optims');
        leftdiv.style.position = 'static';
        leftdiv.style.cssFloat = 'left';
        var rightdiv = document.createElement('div');
        rightdiv.classList.add('all-optims');
        rightdiv.style.position = 'static';
        rightdiv.style.cssFloat = 'right';
        rightdiv.style.paddingLeft = '40px';
        var rightDivTitle = document.createElement('h3');
        rightDivTitle.style.cssFloat = 'center';
        rightDivTitle.appendChild(document.createTextNode("Available optimizations (" + optims.length + ")"));
        rightdiv.appendChild(rightDivTitle);
        rightdiv.appendChild(listnode);
        var sort = Sortable.create(listnode, {
            group: {
                name: 'optims',
                pull: 'clone',
                put: false
            },
            sort: false,
            animation: 150
        });
        newdiv.appendChild(leftdiv);
        newdiv.appendChild(rightdiv);
        _this.phasesDiv = leftdiv;
        var yoffset2 = tabTop + 60;
        _this.optimTabs = cfg_phases.map(optimPhaseMake(canvas, leftdiv, module_base, optims, { color: '#ED7D32', top: yoffset2 }));
        _this.tabManager = TabManager.make(canvas, {
            label: language,
            rectOptions: options.rectOptions,
            textOptions: options.textOptions,
            tabOrigin: options.tabOrigin
        }, _this.optimTabs, 0);
        return _this;
    }
    OptimizationManager.make = function (canvas, options, language, modulebase, optims, cfg_phases, startTab) {
        if (startTab === void 0) { startTab = -1; }
        var tm = new OptimizationManager(canvas, options, language, modulebase, optims, cfg_phases);
        return tm;
    };
    OptimizationManager.prototype.getOptimConfig = function () {
        return {
            language: this.language,
            phases: this.getConfigPhases()
        };
    };
    OptimizationManager.prototype.getConfigPhases = function () {
        return this.optimTabs.map(function (x) { return x.getPhase(); });
    };
    OptimizationManager.prototype.getLabel = function () {
        return this.language;
    };
    OptimizationManager.prototype.getRectOptions = function () {
        return this.rectOptions;
    };
    OptimizationManager.prototype.getTextOptions = function () {
        return this.textOptions;
    };
    OptimizationManager.prototype.show = function () {
        this.tabManager.show();
        this.parentDiv.appendChild(this.topDiv);
        document.getElementById('optim-config-buttons').style.display = "block";
    };
    OptimizationManager.prototype.hide = function () {
        this.tabManager.hide();
        this.parentDiv.removeChild(this.topDiv);
        document.getElementById('optim-config-buttons').style.display = "none";
    };
    return OptimizationManager;
}(ICanvasTab));
function findFirstWithField(l, field, lang) {
    var f = l.filter(function (x) { return x[field] == lang; });
    if (f.length == 0) {
        return undefined;
    }
    else {
        return f[0];
    }
}
// TODO: turn this into a wrapper class so that 
// globalOptimTabs, OptimizationsTabMake, and getOptimConfig
// are encapsulated
var globalOptimTabs;
function OptimizationsTabMake(canvas) {
    return OptimizationsTabMakeFromConfig(canvas, qcertOptimDefaults().optims);
}
function OptimizationsTabMakeFromConfig(canvas, defaults) {
    var yoffset = 60;
    var optims = qcertOptimList().optims;
    console.log("Setting optimization config");
    console.log(optims);
    var opts = { rectOptions: { fill: '#548235' }, tabOrigin: { top: yoffset } };
    var optimTabs = [];
    for (var i = 0; i < optims.length; i++) {
        var opt = optims[i];
        var cfg = findFirstWithField(defaults, 'language', opt.language.name);
        var cfg_phases = cfg === undefined ? [] : cfg.phases;
        optimTabs.push(OptimizationManager.make(canvas, opts, opt.language.name, opt.language.modulebase, opt.optims, cfg_phases));
    }
    globalOptimTabs = optimTabs;
    return TabManager.make(canvas, { label: "Optim Config", rectOptions: { fill: '#FEBF01' } }, optimTabs, 0);
}
function getOptimConfig() {
    if (globalOptimTabs) {
        return globalOptimTabs.map(function (x) { return x.getOptimConfig(); });
    }
    else {
        return [];
    }
}
var tabinitlist = [
    BuilderTab.make,
    OptimizationsTabMake,
    CompileTab.make,
    ExecTab.make
];
function init() {
    mainCanvas = new fabric.Canvas('main-canvas');
    var tabscanvas = new fabric.Canvas('tabs-canvas');
    var tabs = tabinitlist.map(function (elem) {
        return elem(mainCanvas);
    });
    var tm = TabManager.make(tabscanvas, { label: "Q*cert" }, tabs, 0);
    tm.show();
    tabscanvas.renderAll();
    tabManager = tm;
}
function handleCSVs(files) {
    console.log("CSV file handler called");
    var readFiles = {};
    function readFile(index) {
        if (index >= files.length) {
            completeCSVs(readFiles);
            return;
        }
        var file = files[index];
        var reader = new FileReader();
        reader.onload = function (event) {
            var typeName = file.name.endsWith(".csv") ? file.name.substring(0, file.name.length - 4) : file.name;
            readFiles[typeName] = event.target.result;
            readFile(index + 1);
        };
        reader.readAsText(file);
    }
    readFile(0);
}
function completeCSVs(readFiles) {
    var schemaText = document.getElementById("compile-tab-query-schema-text").value;
    if (schemaText.length == 0) {
        getExecInputArea().value = "[ Error: A schema must be specified (on the compile tab) to parse CSV files ]";
        var form = document.getElementById('csvs-form');
        form.reset();
        return;
    }
    var delimiter = document.getElementById("delimiter").value;
    var schema = JSON.parse(schemaText);
    var toSend = JSON.stringify({ schema: schema, delimiter: delimiter, data: readFiles });
    var process = function (result) {
        getExecInputArea().value = result;
    };
    preProcess(toSend, "csv2JSON", process);
}
function handleOptimFile(files) {
    if (files.length > 0) {
        var file_1 = files[0];
        var reader = new FileReader();
        reader.onload = function (event) {
            var contents = event.target.result;
            var optims = JSON.parse(contents);
            addEmptyPhases(optims);
            setConfig(optims);
            setConfigStatus("Configuration loaded from " + file_1.name, true);
        };
        reader.readAsText(file_1);
    }
}
function addEmptyPhases(optims) {
    var empty = getClearConfig();
    for (var i = 0; i < empty.length; i++) {
        var conf = empty[i];
        var match = findFirstWithField(optims, 'language', conf.language);
        if (match) {
            var emptyPhases = conf.phases;
            var matchPhases = match.phases;
            for (var j = 0; j < emptyPhases.length; j++) {
                var phase = emptyPhases[j];
                var phaseMatch = findFirstWithField(matchPhases, 'name', phase.name);
                if (!phaseMatch)
                    // Add the empty phase
                    matchPhases.push(phase);
            }
        }
        else
            // Add the entire empty language with all its phases
            optims.push(conf);
    }
}
function handleFile(output, isSchema, files) {
    if (files.length > 0) {
        var file = files[0];
        var reader = new FileReader();
        var outputElem_1 = document.getElementById(output);
        outputElem_1.value = "[ Reading ]";
        if (file.name.endsWith(".sem")) {
            reader.onload = function (event) {
                var contents = btoa(String.fromCharCode.apply(null, new Uint8Array(event.target.result)));
                outputElem_1.value = contents;
            };
            reader.readAsArrayBuffer(file);
        }
        else {
            reader.onload = function (event) {
                var contents = event.target.result;
                if (isSchema && isSQLSchema(contents))
                    convertSQLSchema(contents, outputElem_1);
                else
                    outputElem_1.value = contents;
            };
            reader.readAsText(file);
        }
    }
}
// Determine if a String contains a SQL schema.  Not intended to be foolproof but just to discriminate the two supported schema
// notations (SQL and JSON) when the input is at least mostly valid.
function isSQLSchema(schemaText) {
    /* A SQL schema should have the word "create" in it but SQL is case insensitive  */
    var create = schemaText.search(/create/i);
    if (create < 0)
        return false;
    var brace = schemaText.indexOf('{');
    if (brace >= 0 && brace < create)
        /* Word create is coincidentally appearing inside what is probably a JSON schema */
        return false;
    /* Looking more like SQL.  Drop any blanks that follow 'create' */
    var balance = schemaText.substring(create + 6).trim();
    /* The next word must be 'table' (case insensitive) */
    var table = balance.search(/table/i);
    return table == 0;
}
function convertSQLSchema(toConvert, outputElem) {
    var process = function (result) {
        outputElem.value = result;
    };
    var result = preProcess(toConvert, "sqlSchema2JSON", process);
}
function handleFileDrop(output, event) {
    event.stopPropagation();
    event.preventDefault();
    var dt = event.dataTransfer;
    var files = dt.files;
    handleFile(output, false, files);
}
function getSrcInput() {
    var elem = document.getElementById('compile-tab-query-src-text');
    return elem.value;
}
function getSchemaInput() {
    var elem = document.getElementById('compile-tab-query-schema-text');
    return elem.value.length > 0 ? elem.value : "{}";
}
function getIOInput() {
    return getExecInputArea().value;
}
function getExecOutputArea() {
    return document.getElementById('execute-tab-query-output-text');
}
function getExecInputArea() {
    return document.getElementById('execute-tab-query-io-text');
}
function getCompiledQuery() {
    var elem = document.getElementById('compile-tab-query-output-text');
    return elem.value;
}
//# sourceMappingURL=demo.js.map