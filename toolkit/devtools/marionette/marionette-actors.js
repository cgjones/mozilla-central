/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";
/**
 * Gecko-specific actors.
 */

var Ci = Components.interfaces;
var Cc = Components.classes;
var Cu = Components.utils;

var loader = Cc["@mozilla.org/moz/jssubscript-loader;1"]
             .getService(Ci.mozIJSSubScriptLoader);
loader.loadSubScript("resource:///modules/marionette-simpletest.js");
loader.loadSubScript("resource:///modules/marionette-log-obj.js");
Components.utils.import("resource:///modules/marionette-elements.js");

var prefs = Cc["@mozilla.org/preferences-service;1"]
            .getService(Ci.nsIPrefBranch);
prefs.setBoolPref("marionette.contentListener", false);

var xulAppInfo = Cc["@mozilla.org/xre/app-info;1"]
                 .getService(Ci.nsIXULAppInfo);
var isB2G = xulAppInfo.name.indexOf('B2G') > -1;

// import logger
Cu.import("resource:///modules/marionette-logger.jsm");
MarionetteLogger.write('marionette-actors.js loaded');

if (isB2G) {
  // prevent 'slow script' dialogs
  prefs.setIntPref("dom.max_script_run_time", 180);
}

/**
 * Creates the root actor once a connection is established
 */

function createRootActor(aConnection)
{
  return new MarionetteRootActor(aConnection);
}

/**
 * Root actor for Marionette. Add any future actors to its actor pool.
 */

function MarionetteRootActor(aConnection)
{
  this.conn = aConnection;
  this._marionetteActor = new MarionetteDriverActor(this.conn);
  this._marionetteActorPool = null; //hold future actors

  this._marionetteActorPool = new ActorPool(this.conn);
  this._marionetteActorPool.addActor(this._marionetteActor);
  this.conn.addActorPool(this._marionetteActorPool);
}

MarionetteRootActor.prototype = {
  sayHello: function MRA_sayHello() {
    return { from: "root",
             applicationType: "gecko",
             traits: [] };
  },

  /**
   * Called when client disconnects. Cleans up marionette driver actions.
   */
  disconnect: function MRA_disconnect() {
    this._marionetteActor.deleteSession();
  },

  /**
   * Used to get the running marionette actor, so we can issue commands
   */
  getMarionetteID: function MRA_getMarionette() {
    return { "from": "root",
             "id": this._marionetteActor.actorID } ;
  },
}

MarionetteRootActor.prototype.requestTypes = {
  "getMarionetteID": MarionetteRootActor.prototype.getMarionetteID,
  "sayHello": MarionetteRootActor.prototype.sayHello
};

/**
 * This actor is responsible for all marionette API calls. It gets created
 * for each connection and manages all chrome and browser based calls. It 
 * mediates content calls by issuing appropriate messages to the content process.
 */

function MarionetteDriverActor(aConnection)
{
  this.conn = aConnection;
  this.messageManager = Cc["@mozilla.org/globalmessagemanager;1"].
                             getService(Ci.nsIChromeFrameMessageManager);
  this.windowMediator = Cc['@mozilla.org/appshell/window-mediator;1'].getService(Ci.nsIWindowMediator);
  this.browsers = {}; //holds list of BrowserObjs
  this.curBrowser = null; // points to current browser
  this.context = "content";
  this.scriptTimeout = null;
  this.elementManager = new ElementManager([SELECTOR, NAME, LINK_TEXT, PARTIAL_LINK_TEXT]);
  this.timer = null;
  this.marionetteLog = new MarionetteLogObj();

  //register all message listeners
  this.messageManager.addMessageListener("Marionette:ok", this);
  this.messageManager.addMessageListener("Marionette:done", this);
  this.messageManager.addMessageListener("Marionette:error", this);
  this.messageManager.addMessageListener("Marionette:log", this);
  this.messageManager.addMessageListener("Marionette:testLog", this);
  this.messageManager.addMessageListener("Marionette:register", this);
  this.messageManager.addMessageListener("Marionette:goUrl", this);
}

MarionetteDriverActor.prototype = {

  actorPrefix: "marionette",

  /**
   * Helper method to send async messages to content
   */
  sendAsync: function MDA_sendAsync(name, values) {
    this.messageManager.sendAsyncMessage("Marionette:" + name + this.browsers[this.curBrowser].curFrameId, values);
  },

  /**
   * Helper methods:
   */

  /**
    * Send response value to client
    */
  sendResponse: function MDA_sendResponse(value) {
    if (typeof(value) == 'undefined')
        value = null;
    this.conn.send({from:this.actorID, value: value});
  },

  /**
   * Send ack to client
   */
  sendOk: function MDA_sendOk() {
    this.conn.send({from:this.actorID, ok: true});
  },

  /**
   * Send error message to client
   */
  sendError: function MDA_sendError(message, status, trace) {
    var error_msg = {message: message, status: status, stacktrace: trace};
    this.conn.send({from:this.actorID, error: error_msg});
  },

  /**
   * Gets the current active window
   */
  getCurrentWindow: function MDA_getCurrentWindow() {
    var type = null;
    if (!isB2G) {
      type = 'navigator:browser';
    }
    return this.windowMediator.getMostRecentWindow(type);
  },

  /**
   * Gets the the window enumerator
   */
  getWinEnumerator: function MDA_getWinEnumerator() {
    var type = 'navigator:browser';
    if (isB2G) {
      type = null;
    }
    return this.windowMediator.getEnumerator(type);
  },

  /**
   * Create a new BrowserObj for window and add to known browsers
   */
  addBrowser: function MDA_addBrowser(win) {
    var browser = new BrowserObj(win);
    var winId = win.QueryInterface(Components.interfaces.nsIInterfaceRequestor).getInterface(Components.interfaces.nsIDOMWindowUtils).outerWindowID;
    winId = winId + (isB2G ? '-b2g' : '');
    if (this.elementManager.seenItems[winId] == undefined) {
      //add this to seenItems so we can guarantee the user will get winId as this window's id
      this.elementManager.seenItems[winId] = win; 
    }
    this.browsers[winId] = browser;
    return winId;
  },

  /**
   * Start a new session in a new browser. 
   *
   * If newSession is true, we will switch focus to the start frame 
   * when it registers. Also, if it is in desktop, then a new tab 
   * with the start page uri (about:blank) will be opened.
   */
  startBrowser: function MDA_startBrowser(win, newSession) {
    var winId = this.addBrowser(win);
    this.curBrowser = winId;
    this.browsers[this.curBrowser].newSession = newSession;
    this.browsers[this.curBrowser].startSession(newSession);
    this.browsers[this.curBrowser].loadFrameScript("resource:///modules/marionette-listener.js", win);
  },

  /**
   * Marionette API:
   */

  /**
   * Create a new session. This creates a BrowserObj.
   *
   * In a desktop environment, this opens a new 'about:blank' tab for 
   * the client to test in.
   */
  newSession: function MDA_newSession(aRequest) {
    if (!prefs.getBoolPref("marionette.contentListener")) {
      this.startBrowser(this.getCurrentWindow(), true);
    }
    else if (isB2G && (this.curBrowser == null)) {
      //if there is a content listener, then we just wake it up
      var winId = this.addBrowser(this.getCurrentWindow());
      this.curBrowser = winId;
      this.browsers[this.curBrowser].startSession(false);
      this.messageManager.sendAsyncMessage("Marionette:restart", {});
    }
    else {
      this.sendError("Session already running", 500, null);
    }
  },

  /**
   * Log message. Accepts user defined log-level.
   */
  log: function MDA_log(aRequest) {
    this.marionetteLog.log(aRequest.value, aRequest.level);
    this.sendOk();
  },

  /**
   * Return all logged messages.
   */
  getLogs: function MDA_getLogs(aRequest) {
    this.sendResponse(this.marionetteLog.getLogs());
  },

  /**
   * Sets the context of the subsequent commands to be either 'chrome' or 'content'
   */
  setContext: function MDA_setContext(aRequest) {
    var context = aRequest.value;
    if (context != "content" && context != "chrome") {
      this.sendError("invalid context", 500, null);
    }
    else {
      this.context = context;
      this.sendOk();
    }
  },

  /**
   * Execute the given script either as a function body (executeScript)
   * or directly (for 'mochitest' like JS Marionette tests)
   */
  execute: function MDA_execute(aRequest, directInject) {
    if (this.context == "chrome") {
      var curWindow = this.getCurrentWindow();
      var args = aRequest.args;
      try {
        args = this.elementManager.convertWrappedArguments(args, curWindow);
      }
      catch(e) {
        this.sendError(e.message, e.num, e.stack);
        return;
      }
      try {
        Marionette.is_async = false;
        Marionette.tests = [];
        Marionette.context = "chrome";
        Marionette.win = curWindow;
        Marionette.logObj = this.marionetteLog;
        this.elementManager.applyNamedArgs(args, Marionette)
        var _chromeSandbox = new Cu.Sandbox(curWindow,
           { sandboxPrototype: curWindow, wantXrays: false, 
             sandboxName: ''});
        _chromeSandbox.Marionette = Marionette;
        if (directInject) {
          //we can assume this is a marionette test, so provide convenience funcs:
          _chromeSandbox.is = _chromeSandbox.Marionette.is;
          _chromeSandbox.isnot = _chromeSandbox.Marionette.isnot;
          _chromeSandbox.ok = _chromeSandbox.Marionette.ok;
          _chromeSandbox.log = _chromeSandbox.Marionette.log;
          _chromeSandbox.getLogs = _chromeSandbox.Marionette.getLogs;
          _chromeSandbox.finish = _chromeSandbox.Marionette.finish;
          //run the given script directly
          var res = Cu.evalInSandbox(aRequest.value, _chromeSandbox, "1.8");
          if (res == undefined || res.passed == undefined) {
            this.sendError("Marionette.finish() not called", 500, null);
          }
          else {
            this.sendResponse(this.elementManager.wrapValue(res));
          }
        }
        else {
          _chromeSandbox.__marionetteParams = args;
          var script = "var func = function() {" + aRequest.value + "}; func.apply(null, __marionetteParams);";
          var res = Cu.evalInSandbox(script, _chromeSandbox, "1.8");
          this.sendResponse(this.elementManager.wrapValue(res));
        }
      }
      catch (e) {
        this.sendError(e.name + ': ' + e.message, 17, e.stack);
      }
      Marionette.reset();
    }
    else {
      this.sendAsync("executeScript", {value: aRequest.value, args: aRequest.args});
    }
  },

  /**
   * Set the timeout for asynchronous script execution
   */
  setScriptTimeout: function MDA_setScriptTimeout(aRequest) {
    var timeout = parseInt(aRequest.value);
    if(isNaN(timeout)){
      this.sendError("Not a Number", 500, null);
    }
    else {
      this.scriptTimeout = timeout;
      this.sendAsync("setScriptTimeout", {value: timeout});
      this.sendOk();
    }
  },

  /**
   * execute async script
   */
  executeAsync: function MDA_executeAsync(aRequest) {
    this.executeWithCallback(aRequest);
  },

  /**
   * execute pure JS script. Used to execute 'mochitest'-style Marionette tests.
   */
  executeJSScript: function MDA_executeJSScript(aRequest) {
    //all pure JS scripts will need to call Marionette.finish() to complete the test.
    if (this.context == "chrome") {
      if (aRequest.timeout) {
        this.executeWithCallback(aRequest, aRequest.timeout);
      }
      else {
        this.execute(aRequest, true);
      }
    }
    else {
      this.sendAsync("executeJSScript", {value:aRequest.value, args:aRequest.args, timeout:aRequest.timeout});
   }
  },

  /**
   * This function is used by executeAsync and executeJSScript to execute a script
   * in a sandbox. 
   * 
   * For executeJSScript, it will return a message only when the finish() method is called.
   * For executeAsync, it will return a response when marionetteScriptFinished/arguments[arguments.length-1] 
   * method is called, or if it times out.
   */
  executeWithCallback: function MDA_executeWithCallback(aRequest, timeout) {
    if (this.context == "chrome") {
      var curWindow = this.getCurrentWindow();
      var args = aRequest.args;
      try {
        args = this.elementManager.convertWrappedArguments(args, curWindow);
      }
      catch(e) {
        this.sendError(e.message, e.num, e.stack);
        return;
      }
      try {
        Marionette.tests = [];
        Marionette.is_async = true;
        Marionette.context = "chrome";
        Marionette.win = curWindow;
        Marionette.onerror = curWindow.onerror;
        Marionette.logObj = this.marionetteLog;
        Marionette.__conn = this.conn;
        Marionette.__actorID = this.actorID;
        Marionette.__elementManager = this.elementManager;
        this.elementManager.applyNamedArgs(args, Marionette);
        this.timer = Cc["@mozilla.org/timer;1"].createInstance(Ci.nsITimer);
        Marionette.__timer = this.timer;
        var _chromeSandbox = new Cu.Sandbox(curWindow,
           { sandboxPrototype: curWindow, wantXrays: false, sandboxName: ''});
        _chromeSandbox.__marionetteParams = args;
        _chromeSandbox.Marionette = Marionette;
        _chromeSandbox.is = _chromeSandbox.Marionette.is;
        _chromeSandbox.isnot = _chromeSandbox.Marionette.isnot;
        _chromeSandbox.ok = _chromeSandbox.Marionette.ok;
        _chromeSandbox.log = _chromeSandbox.Marionette.log;
        _chromeSandbox.getLogs = _chromeSandbox.Marionette.getLogs;
        _chromeSandbox.finish = _chromeSandbox.Marionette.finish;
        var script;
        //define the timeout function and catch any potential errors thrown by the user script
        var timeoutScript = 'var timeoutFunc = function() {Marionette.returnFunc("timed out", 28);};'
                           + 'window.onerror = function (errorMsg, url, lineNumber) {'
                           + 'Marionette.returnFunc(errorMsg + " at: " + url + " line: " + lineNumber, 17); ; return true};'
                           + 'if(Marionette.__timer != null) {Marionette.__timer.initWithCallback(timeoutFunc, '+ this.scriptTimeout +', Components.interfaces.nsITimer.TYPE_ONE_SHOT);}';
        if (timeout) {
          if (this.scriptTimeout == null || this.scriptTimeout == 0) {
            this.sendError("Please set a timeout", 21, null);
          }
          //don't wrap sent JS in function
          script = aRequest.value + timeoutScript;
        }
        else {
          script = '__marionetteParams.push(Marionette.returnFunc);'
                  + 'var marionetteScriptFinished = Marionette.returnFunc;'
                  + 'var __marionetteFunc = function() {' + aRequest.value + '};'
                  + '__marionetteFunc.apply(null, __marionetteParams);'
                  + timeoutScript;
        }
        Cu.evalInSandbox(script, _chromeSandbox, "1.8");
      } catch (e) {
        this.sendError(e.name + ": " + e.message, 17, e.stack);
      }
    }
    else {
      this.sendAsync("executeAsyncScript", {value: aRequest.value, args: aRequest.args});
    }
  },

  /**
   * Navigates to given url
   */
  goUrl: function MDA_goUrl(aRequest) {
    this.sendAsync("goUrl", aRequest);
  },

  /**
   * Gets current url
   */
  getUrl: function MDA_getUrl(aRequest) {
    this.sendAsync("getUrl", {});
  },

  /**
   * Go back in history
   */
  goBack: function MDA_goBack(aRequest) {
    this.sendAsync("goBack", {});
  },

  /**
   * Go forward in history
   */
  goForward: function MDA_goForward(aRequest) {
    this.sendAsync("goForward", {});
  },

  /**
   * Refresh the page
   */
  refresh: function MDA_refresh(aRequest) {
    this.sendAsync("refresh", {});
  },

  /**
   * Get the current window's server-assigned ID
   */
  getWindow: function MDA_getWindow(aRequest) {
    this.sendResponse(this.curBrowser);
  },

  /**
   * Get the server-assigned IDs of all available windows
   */
  getWindows: function MDA_getWindows(aRequest) {
    var res = [];
    var winEn = this.getWinEnumerator(); 
    while(winEn.hasMoreElements()) {
      var foundWin = winEn.getNext();
      var winId = foundWin.QueryInterface(Components.interfaces.nsIInterfaceRequestor).getInterface(Components.interfaces.nsIDOMWindowUtils).outerWindowID;
      var winId = winId + (isB2G ? '-b2g' : '');
      res.push(winId)
    }
    this.sendResponse(res);
  },

  /**
   * Switch to a window based on name or server-assigned id.
   * Searches based on name, then id.
   */
  switchToWindow: function MDA_switchToWindow(aRequest) {
    var winEn = this.getWinEnumerator(); 
    while(winEn.hasMoreElements()) {
      var foundWin = winEn.getNext();
      var winId = foundWin.QueryInterface(Components.interfaces.nsIInterfaceRequestor).getInterface(Components.interfaces.nsIDOMWindowUtils).outerWindowID;
      winId = winId + (isB2G ? '-b2g' : '');
      if (aRequest.value == foundWin.name || aRequest.value == winId) {
        if (this.browsers[winId] == undefined) {
          //enable Marionette in that browser window
          this.startBrowser(foundWin, false);
        }
        foundWin.focus();
        this.curBrowser = winId;
        this.sendOk();
        return;
      }
    }
    this.sendError("Unable to locate window " + aRequest.value, 23, null);
  },

  /**
   * Switch to a given frame within the current window
   */
  switchToFrame: function MDA_switchToFrame(aRequest) {
    this.sendAsync("switchToFrame", aRequest);
  },

  /**
   * Set timeout for searching for elements
   */
  setSearchTimeout: function MDA_setSearchTimeout(aRequest) {
    if (this.context == "chrome") {
      try {
        this.elementManager.setSearchTimeout(aRequest.value);
        this.sendOk();
      }
      catch (e) {
        this.sendError(e.message, e.num, e.stack);
      }
    }
    else {
      this.sendAsync("setSearchTimeout", {value: aRequest.value});
    }
  },

  /**
   * Find an element using the indicated search strategy.
   */
  findElement: function MDA_findElement(aRequest) {
    if (this.context == "chrome") {
      var id;
      try {
        var notify = this.sendResponse.bind(this);
        id = this.elementManager.find(aRequest, this.getCurrentWindow().document, notify, false);
      }
      catch (e) {
        this.sendError(e.message, e.num, e.stack);
        return;
      }
    }
    else {
      this.sendAsync("findElementContent", {value: aRequest.value, using: aRequest.using, element: aRequest.element});
    }
  },

  /**
   * Find elements using the indicated search strategy.
   */
  findElements: function MDA_findElements(aRequest) {
    if (this.context == "chrome") {
      var id;
      try {
        var notify = this.sendResponse.bind(this);
        id = this.elementManager.find(aRequest, this.getCurrentWindow().document, notify, true);
      }
      catch (e) {
        this.sendError(e.message, e.num, e.stack);
        return;
      }
    }
    else {
      this.sendAsync("findElementsContent", {value: aRequest.value, using: aRequest.using, element: aRequest.element});
    }
  },
  /**
   * Send click event to element
   */
  clickElement: function MDA_clickElement(aRequest) {
    this.sendAsync("clickElement", {element: aRequest.element});
  },

  /**
   * Deletes the session.
   * 
   * If it is a desktop environment, it will close the session's tab and close all listeners
   *
   * If it is a B2G environment, it will make the main content listener sleep, and close
   * all other listeners. The main content listener persists after disconnect (it's the homescreen),
   * and can safely be reused.
   */
  deleteSession: function MDA_deleteSession(aRequest) {
    if (this.browsers[this.curBrowser] != null) {
      if (isB2G) {
        this.messageManager.sendAsyncMessage("Marionette:sleepSession" + this.browsers[this.curBrowser].mainContentId, {});
        this.browsers[this.curBrowser].knownFrames.splice(this.browsers[this.curBrowser].knownFrames.indexOf(this.browsers[this.curBrowser].mainContentId), 1);
      }
      else {
        //don't set this pref for B2G since the framescript can be safely reused
        prefs.setBoolPref("marionette.contentListener", false);
      }
      this.browsers[this.curBrowser].closeTab();
      //delete session in each frame in each browser
      for (var win in this.browsers) {
        for (var i in this.browsers[win].knownFrames) {
          this.messageManager.sendAsyncMessage("Marionette:deleteSession" + this.browsers[win].knownFrames[i], {});
        }
      }
      var winEnum = this.getWinEnumerator();
      while (winEnum.hasMoreElements()) {
        winEnum.getNext().messageManager.removeDelayedFrameScript("resource:///modules/marionette-listener.js"); 
      }
    }
    this.sendOk();
    this.messageManager.removeMessageListener("Marionette:ok", this);
    this.messageManager.removeMessageListener("Marionette:done", this);
    this.messageManager.removeMessageListener("Marionette:error", this);
    this.messageManager.removeMessageListener("Marionette:log", this);
    this.messageManager.removeMessageListener("Marionette:testLog", this);
    this.messageManager.removeMessageListener("Marionette:register", this);
    this.messageManager.removeMessageListener("Marionette:goUrl", this);
    this.curBrowser = null;
    this.elementManager.reset();
  },

  /**
   * Receives all messages from content messageManager
   */
  receiveMessage: function MDA_receiveMessage(message) {
    switch (message.name) {
      case "DOMContentLoaded":
        this.sendOk();
        this.messageManager.removeMessageListener("DOMContentLoaded", this, true);
        break;
      case "Marionette:done":
        this.sendResponse(message.json.value);
        break;
      case "Marionette:ok":
        this.sendOk();
        break;
      case "Marionette:error":
        this.sendError(message.json.message, message.json.status, message.json.stacktrace);
        break;
      case "Marionette:log":
        //log server-side messages
        MarionetteLogger.write(message.json.message);
        break;
      case "Marionette:testLog":
        //log messages from tests
        this.marionetteLog.addLogs(message.json.value);
        break;
      case "Marionette:register":
        // This code processes the content listener's registration information
        // and either accepts the listener, or ignores it
        var nullPrevious= (this.browsers[this.curBrowser].curFrameId == null);
        var curWin = this.getCurrentWindow();
        var frameObject = curWin.QueryInterface(Components.interfaces.nsIInterfaceRequestor).getInterface(Components.interfaces.nsIDOMWindowUtils).getOuterWindowWithId(message.json.value);
        var reg = this.browsers[this.curBrowser].register(message.json.value, message.json.href);
        if (reg) {
          this.elementManager.seenItems[reg] = frameObject; //add to seenItems
          if (nullPrevious && (this.browsers[this.curBrowser].curFrameId != null)) {
            this.sendAsync("newSession", {B2G: isB2G});
            if (this.browsers[this.curBrowser].newSession) {
              this.sendResponse(reg);
            }
          }
        }
        return reg;
      case "Marionette:goUrl":
        // if content determines that the goUrl call is directed at a top level window (not an iframe)
        // it calls back into chrome to load the uri.
        this.browsers[this.curBrowser].loadURI(message.json.value, this);
        break;
    }
  },
  /**
   * for non-e10s eventListening
   */
  handleEvent: function MDA_handleEvent(evt) {
    if (evt.type == "DOMContentLoaded") {
      this.sendOk();
      this.browsers[this.curBrowser].browser.removeEventListener("DOMContentLoaded", this, false);
    }
  },
};

MarionetteDriverActor.prototype.requestTypes = {
  "newSession": MarionetteDriverActor.prototype.newSession,
  "log": MarionetteDriverActor.prototype.log,
  "getLogs": MarionetteDriverActor.prototype.getLogs,
  "setContext": MarionetteDriverActor.prototype.setContext,
  "executeScript": MarionetteDriverActor.prototype.execute,
  "setScriptTimeout": MarionetteDriverActor.prototype.setScriptTimeout,
  "executeAsyncScript": MarionetteDriverActor.prototype.executeAsync,
  "executeJSScript": MarionetteDriverActor.prototype.executeJSScript,
  "setSearchTimeout": MarionetteDriverActor.prototype.setSearchTimeout,
  "findElement": MarionetteDriverActor.prototype.findElement,
  "findElements": MarionetteDriverActor.prototype.findElements,
  "clickElement": MarionetteDriverActor.prototype.clickElement,
  "goUrl": MarionetteDriverActor.prototype.goUrl,
  "getUrl": MarionetteDriverActor.prototype.getUrl,
  "goBack": MarionetteDriverActor.prototype.goBack,
  "goForward": MarionetteDriverActor.prototype.goForward,
  "refresh":  MarionetteDriverActor.prototype.refresh,
  "getWindow":  MarionetteDriverActor.prototype.getWindow,
  "getWindows":  MarionetteDriverActor.prototype.getWindows,
  "switchToFrame": MarionetteDriverActor.prototype.switchToFrame,
  "switchToWindow": MarionetteDriverActor.prototype.switchToWindow,
  "deleteSession": MarionetteDriverActor.prototype.deleteSession
};

/**
 * Creates a BrowserObj. BrowserObjs handle interactions with the
 * browser, according to the current environment (desktop, b2g, etc.)
 *
 * @param nsIDOMWindow win
 *        The window whose browser needs to be accessed
 */

function BrowserObj(win) {
  this.DESKTOP = "desktop";
  this.B2G = "B2G";
  this.FENNEC = "fennec";
  this.browser;
  this.browser_mm;
  this.tab = null;
  this.knownFrames = [];
  this.curFrameId = null;
  this.startPage = "about:blank";
  this.mainContentId = null; // used in B2G to identify the homescreen content page
  this.messageManager = Cc["@mozilla.org/globalmessagemanager;1"].
                             getService(Ci.nsIChromeFrameMessageManager);
  this.newSession = true; //used to set curFrameId upon new session
  this.setEnvironment(win);
}

BrowserObj.prototype = {
  /**
   * Get the browser and environment type from window
   */
  setEnvironment: function BO_setEnvironment(win) {
    if (win.gBrowser != undefined) {
      this.type = this.DESKTOP; 
      this.browser = win.gBrowser; 
    }
    else if (win.Browser != undefined) {
      this.type = this.FENNEC;
      this.browser = win.Browser; //BrowserApp for birch?
    }
    else {
      this.type = this.B2G;
    }
  },
  /**
   * Called when we start a session with this browser.
   *
   * In a desktop environment, if newTab is true, it will start 
   * a new 'about:blank' tab and change focus to this tab.
   *
   * This will also set the active messagemanager for this object
   */
  startSession: function BO_startSession(newTab) {
    if (this.type == this.B2G) {
      return;
    }
    if (newTab) {
      this.addTab(this.startPage);
    }
    if (this.type == this.DESKTOP) {
      if (newTab) {
        //if we have a new tab, make it the selected tab and give it focus
        this.browser.selectedTab = this.tab;
        var newTabBrowser = this.browser.getBrowserForTab(this.tab);
        //focus the tab
        newTabBrowser.ownerDocument.defaultView.focus();
      }
      else {
        //set this.tab to the currently focused tab
        this.tab = this.browser.selectedTab;
        this.browser_mm = this.browser.getBrowserForTab(this.tab).messageManager;
      }
    }
    else {
      this.browser_mm = this.tab.browser.messageManager;
    }
  },

  /**
   * Closes current tab
   */
  closeTab: function BO_closeTab() {
    if (this.tab != null && (this.type == this.DESKTOP)) {
      this.browser.removeTab(this.tab);
      this.tab = null;
    }
  },

  /**
   * Opens a tab with given uri
   */
  addTab: function BO_addTab(uri) {
    this.tab = this.browser.addTab(uri, true);
  },

  /**
   * Load a uri in the current tab
   */
  loadURI: function BO_openURI(uri, listener) {
    if (this.type == this.DESKTOP) {
      this.browser.addEventListener("DOMContentLoaded", listener, false);
      this.browser.loadURI(uri);
    }
    else {
      this.messageManager.addMessageListener("DOMContentLoaded", listener, true);
      this.browser.selectedBrowser.loadURI(uri);
    }
  },

  /**
   * Loads content listeners if we don't already have them
   */
  loadFrameScript: function BO_loadFrameScript(script, frame) {
    if (!prefs.getBoolPref("marionette.contentListener")) {
      frame.window.messageManager.loadFrameScript(script, true);
      prefs.setBoolPref("marionette.contentListener", true);
    }
  },

  /**
   * Registers a new frame, and sets its current frame id to this frame
   * if it is not already assigned, and if a) we already have a session 
   * or b) we're starting a new session and it is the right start frame.
   */
  register: function BO_register(id, href) {
    var uid = id + (this.type == this.B2G ? '-b2g' : '');
    if (this.curFrameId == null) {
      if ((!this.newSession) || (this.newSession && ((this.type == this.B2G) || href.indexOf(this.startPage) > -1))) {
        this.curFrameId = uid;
        this.mainContentId = uid;
      }
    }
    this.knownFrames.push(uid); //used to deletesessions
    return uid;
  },
}
