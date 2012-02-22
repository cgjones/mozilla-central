/* -*- Mode: javascript; tab-width: 2; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

var Cu = Components.utils;
var uuidGen = Components.classes["@mozilla.org/uuid-generator;1"]
             .getService(Components.interfaces.nsIUUIDGenerator);

var loader = Components.classes["@mozilla.org/moz/jssubscript-loader;1"]
             .getService(Components.interfaces.mozIJSSubScriptLoader);
loader.loadSubScript("resource:///modules/marionette-simpletest.js");
loader.loadSubScript("resource:///modules/marionette-log-obj.js");
Components.utils.import("resource:///modules/marionette-elements.js");
var marionetteLogObj = new MarionetteLogObj();

var isB2G = false;

var marionetteTimeout = null;
var winUtil = content.QueryInterface(Components.interfaces.nsIInterfaceRequestor).getInterface(Components.interfaces.nsIDOMWindowUtils);
var listenerId = null; //unique ID of this listener
var activeFrame = null;
var win = content;
var elementManager = new ElementManager([]);

/**
 * Called when listener is first started up. 
 * The listener sends its unique window ID and its current URI to the actor.
 * If the actor returns an ID, we start the listeners. Otherwise, nothing happens.
 */
function registerSelf() {
  var register = sendSyncMessage("Marionette:register", {value: winUtil.outerWindowID, href: content.location.href});
  
  if (register[0]) {
    listenerId = register[0];
    startListeners();
  }
}

/**
 * Start all message listeners
 */
function startListeners() {
  addMessageListener("Marionette:newSession" + listenerId, newSession);
  addMessageListener("Marionette:executeScript" + listenerId, executeScript);
  addMessageListener("Marionette:setScriptTimeout" + listenerId, setScriptTimeout);
  addMessageListener("Marionette:executeAsyncScript" + listenerId, executeAsyncScript);
  addMessageListener("Marionette:executeJSScript" + listenerId, executeJSScript);
  addMessageListener("Marionette:setSearchTimeout" + listenerId, setSearchTimeout);
  addMessageListener("Marionette:goUrl" + listenerId, goUrl);
  addMessageListener("Marionette:getUrl" + listenerId, getUrl);
  addMessageListener("Marionette:goBack" + listenerId, goBack);
  addMessageListener("Marionette:goForward" + listenerId, goForward);
  addMessageListener("Marionette:refresh" + listenerId, refresh);
  addMessageListener("Marionette:findElementContent" + listenerId, findElementContent);
  addMessageListener("Marionette:findElementsContent" + listenerId, findElementsContent);
  addMessageListener("Marionette:clickElement" + listenerId, clickElement);
  addMessageListener("Marionette:switchToFrame" + listenerId, switchToFrame);
  addMessageListener("Marionette:deleteSession" + listenerId, deleteSession);
  addMessageListener("Marionette:sleepSession" + listenerId, sleepSession);
}

/**
 * Called when we start a new session. It registers the
 * current environment, and resets all values
 */
function newSession(msg) {
  isB2G = msg.json.B2G;
  resetValues();
}
 
/**
 * Puts the current session to sleep, so all listeners are removed except
 * for the 'restart' listener. This is used to keep the content listener
 * alive for reuse in B2G instead of reloading it each time.
 */
function sleepSession(msg) {
  deleteSession();
  addMessageListener("Marionette:restart", restart);
}

/**
 * Restarts all our listeners after this listener was put to sleep
 */
function restart() {
  removeMessageListener("Marionette:restart", restart);
  registerSelf();
}

/**
 * Removes all listeners
 */
function deleteSession(msg) {
  removeMessageListener("Marionette:newSession" + listenerId, newSession);
  removeMessageListener("Marionette:executeScript" + listenerId, executeScript);
  removeMessageListener("Marionette:setScriptTimeout" + listenerId, setScriptTimeout);
  removeMessageListener("Marionette:executeAsyncScript" + listenerId, executeAsyncScript);
  removeMessageListener("Marionette:executeJSScript" + listenerId, executeJSScript);
  removeMessageListener("Marionette:setSearchTimeout" + listenerId, setSearchTimeout);
  removeMessageListener("Marionette:goUrl" + listenerId, goUrl);
  removeMessageListener("Marionette:getUrl" + listenerId, getUrl);
  removeMessageListener("Marionette:goBack" + listenerId, goBack);
  removeMessageListener("Marionette:goForward" + listenerId, goForward);
  removeMessageListener("Marionette:refresh" + listenerId, refresh);
  removeMessageListener("Marionette:findElementContent" + listenerId, findElementContent);
  removeMessageListener("Marionette:findElementsContent" + listenerId, findElementsContent);
  removeMessageListener("Marionette:clickElement" + listenerId, clickElement);
  removeMessageListener("Marionette:switchToFrame" + listenerId, switchToFrame);
  removeMessageListener("Marionette:deleteSession" + listenerId, deleteSession);
  removeMessageListener("Marionette:sleepSession" + listenerId, sleepSession);
  this.elementManager.reset();
}

/*
 * Helper methods 
 */

/**
 * Send response back to server
 */
function sendResponse(value) {
  sendAsyncMessage("Marionette:done", value);
}

/**
 * Send ack back to server
 */
function sendOk() {
  sendAsyncMessage("Marionette:ok", {});
}

/**
 * Send log message to server
 */
function sendLog(msg) {
  sendAsyncMessage("Marionette:log", { message: msg });
}

/**
 * Send error message to server
 */
function sendError(message, status, trace) {
  var error_msg = { message: message, status: status, stacktrace: trace };
  sendAsyncMessage("Marionette:error", error_msg);
}

/**
 * Clear test values after completion of test
 */
function resetValues() {
  marionetteTimeout = null;
  Marionette.tests = [];
}

/**
 * send error when we detect an unload event during async scripts
 */
function errUnload() {
  sendError("unload was called", 17, null);
}

/**
 * Upon completion or error from the async script, send response to marionette-responder
 */
function asyncResponse() {
  win.removeEventListener("unload", errUnload, false);
  win.document.removeEventListener("marionette-async-response", asyncResponse, false);

  /* clear all timeouts potentially generated by the script*/
  var maxTimeoutId = win.document.getUserData('__marionetteTimeoutId');
  for(var i=0; i<=maxTimeoutId; i++) {
    win.clearTimeout(i);
  }

  var res = win.document.getUserData('__marionetteRes');
  sendSyncMessage("Marionette:testLog", {value: elementManager.wrapValue(marionetteLogObj.getLogs())});
  marionetteLogObj.clearLogs();
  if (res.status == 0){
    sendResponse({value: elementManager.wrapValue(res.value), status: res.status});
  }
  else {
    sendError(res.value, res.status, null);
  }
  Marionette.reset();
}

/*
 * Marionette Methods
 */

/**
 * Execute the given script either as a function body (executeScript)
 * or directly (for 'mochitest' like JS Marionette tests)
 */
function executeScript(msg, directInject) {
  var script = msg.json.value;
  var args = msg.json.args;
  try {
    args = elementManager.convertWrappedArguments(args, win);
  }
  catch(e) {
    sendError(e.message, e.num, e.stack);
    return;
  }

  Marionette.is_async = false;
  Marionette.win = win;
  Marionette.context = "content";
  Marionette.logObj = marionetteLogObj;
  elementManager.applyNamedArgs(args, Marionette);

  var sandbox = new Cu.Sandbox(win);
  sandbox.window = win;
  sandbox.document = sandbox.window.document;
  sandbox.navigator = sandbox.window.navigator;
  sandbox.__marionetteParams = args;
  sandbox.__proto__ = sandbox.window;
  sandbox.Marionette = Marionette;
  try {
    if (directInject) {
      //we can assume this is a marionette test, so provide convenience funcs:
      sandbox.is = sandbox.Marionette.is;
      sandbox.isnot = sandbox.Marionette.isnot;
      sandbox.ok = sandbox.Marionette.ok;
      sandbox.log = sandbox.Marionette.log;
      sandbox.getLogs = sandbox.Marionette.getLogs;
      sandbox.finish = sandbox.Marionette.finish;
      var res = Cu.evalInSandbox(script, sandbox, "1.8");
      sendSyncMessage("Marionette:testLog", {value: elementManager.wrapValue(marionetteLogObj.getLogs())});
      marionetteLogObj.clearLogs();
      if (res == undefined || res.passed == undefined) {
        sendError("Marionette.finish() not called", 17, null);
      }
      else {
        sendResponse({value: elementManager.wrapValue(res)});
      }
    }
    else {
      var scriptSrc = "var __marionetteFunc = function(){" + script +
                    "};  __marionetteFunc.apply(null, __marionetteParams);";
      var res = Cu.evalInSandbox(scriptSrc, sandbox, "1.8");
      sendSyncMessage("Marionette:testLog", {value: elementManager.wrapValue(marionetteLogObj.getLogs())});
      marionetteLogObj.clearLogs();
      sendResponse({value: elementManager.wrapValue(res)});
    }
  }
  catch (e) {
    // 17 = JavascriptException
    sendError(e.name + ': ' + e.message, 17, e.stack);
  }
  Marionette.reset();
}

/**
 * Function to set the timeout of asynchronous scripts
 */
function setScriptTimeout(msg) {
  marionetteTimeout = msg.json.value;
}

/**
 * Execute async script
 */
function executeAsyncScript(msg) {
  executeWithCallback(msg);
}

/**
 * Execute pure JS test. Handles both async and sync cases.
 */
function executeJSScript(msg) {
  if (msg.json.timeout) {
    executeWithCallback(msg, msg.json.timeout);
  }
  else {
    executeScript(msg, true);
  }
}

/**
 * This function is used by executeAsync and executeJSScript to execute a script
 * in a sandbox. 
 * 
 * For executeJSScript, it will return a message only when the finish() method is called.
 * For executeAsync, it will return a response when marionetteScriptFinished/arguments[arguments.length-1] 
 * method is called, or if it times out.
 */
function executeWithCallback(msg, timeout) {
  win.addEventListener("unload", errUnload, false);
  var script = msg.json.value;
  var scriptSrc;
  var args = msg.json.args ? msg.json.args : [];
  try {
    args = elementManager.convertWrappedArguments(args, win);
  }
  catch(e) {
    sendError(e.message, e.num, e.stack);
    return;
  }

  // Error code 28 is scriptTimeout, but spec says execute_async should return 21 (Timeout),
  // see http://code.google.com/p/selenium/wiki/JsonWireProtocol#/session/:sessionId/execute_async.
  // However Selenium code returns 28, see
  // http://code.google.com/p/selenium/source/browse/trunk/javascript/firefox-driver/js/evaluate.js.
  // We'll stay compatible with the Selenium code.


  var timeoutSrc = "var timeoutId = window.setTimeout(Marionette.asyncComplete," + marionetteTimeout + ", 'timed out', 28);" + 
                   "window.addEventListener('error', function (evt) { window.removeEventListener('error', arguments.callee, true); Marionette.asyncComplete(evt.target.status, 17); return true;}, true);" +
                   "window.document.setUserData('__marionetteTimeoutId', timeoutId, null);";
  if (timeout) {
    if (marionetteTimeout == null || marionetteTimeout == 0) {
      sendError("Please set a timeout", 21, null);
    }
    scriptSrc = script + timeoutSrc;
  }
  else {
    scriptSrc = "var marionetteScriptFinished = function(value) { return Marionette.asyncComplete(value,0);};" +
                  "__marionetteParams.push(marionetteScriptFinished);" +
                  "var __marionetteFunc = function() { " + script +
                  "};  __marionetteFunc.apply(null, __marionetteParams); " + 
                  timeoutSrc;
  }
  win.document.addEventListener("marionette-async-response", asyncResponse, false);

  Marionette.is_async = true;
  Marionette.win = win;
  Marionette.context = "content";
  Marionette.onerror = win.onerror;
  Marionette.logObj = marionetteLogObj;
  elementManager.applyNamedArgs(args, Marionette);

  var sandbox = new Cu.Sandbox(win);
  sandbox.window = win;
  sandbox.document = sandbox.window.document;
  sandbox.timeoutId = null;
  sandbox.navigator = sandbox.window.navigator;
  sandbox.__marionetteParams = args;
  sandbox.document.setUserData("__marionetteRes", {}, null);
  sandbox.__proto__ = sandbox.window;
  sandbox.Marionette = Marionette;
  sandbox.is = Marionette.is;
  sandbox.isnot = Marionette.isnot;
  sandbox.ok = Marionette.ok;
  sandbox.log = sandbox.Marionette.log;
  sandbox.getLogs = sandbox.Marionette.getLogs;
  sandbox.finish = Marionette.finish;
  try {
   Cu.evalInSandbox(scriptSrc, sandbox, "1.8");
  } catch (e) {
    // 17 = JavascriptException
    sendError(e.name + ': ' + e.message, 17, e.stack);
  }
}

/**
 * Function to set the timeout period for element searching 
 */
function setSearchTimeout(msg) {
  try {
    elementManager.setSearchTimeout(msg.json.value);
  }
  catch (e) {
    sendError(e.message, e.num, e.stack);
    return;
  }
  sendOk();
}

/**
 * Navigate to URI. Handles the case where we navigate within an iframe.
 * All other navigation is handled by the server (in chrome space).
 */
function goUrl(msg) {
  if (activeFrame != null) {
    win.document.location = msg.json.value;
    //TODO: replace this with event firing when Bug 720714 is resolved
    var checkTimer = Components.classes["@mozilla.org/timer;1"].createInstance(Components.interfaces.nsITimer);
    var checkLoad = function () { 
                      if (win.document.readyState == "complete") { 
                        sendOk();
                      } 
                      else { 
                        checkTimer.initWithCallback(checkLoad, 100, Components.interfaces.nsITimer.TYPE_ONE_SHOT);
                      }
                    };
    checkLoad();
  }
  else {
    sendAsyncMessage("Marionette:goUrl", {value: msg.json.value});
  }
}

/**
 * Get the current URI
 */
function getUrl(msg) {
  sendResponse({value: win.location.href});
}

/**
 * Go back in history 
 */
function goBack(msg) {
  win.history.back();
  sendOk();
}

/**
 * Go forward in history 
 */
function goForward(msg) {
  win.history.forward();
  sendOk();
}

/**
 * Refresh the page
 */
function refresh(msg) {
  win.location.reload(true);
  var listen = function() { removeEventListener("DOMContentLoaded", arguments.callee, false); sendOk() } ;
  addEventListener("DOMContentLoaded", listen, false);
}

/**
 * Find an element in the document using requested search strategy 
 */
function findElementContent(msg) {
  //Todo: extend to support findChildElement
  var id;
  try {
    var notify = function(id) { sendResponse({value:id});};
    id = elementManager.find(msg.json, win.document, notify, false);
  }
  catch (e) {
    sendError(e.message, e.num, e.stack);
    return;
  }
}

/**
 * Find elements in the document using requested search strategy 
 */
function findElementsContent(msg) {
  //Todo: extend to support findChildElement
  var id;
  try {
    var notify = function(id) { sendResponse({value:id});};
    id = elementManager.find(msg.json, win.document, notify, true);
  }
  catch (e) {
    sendError(e.message, e.num, e.stack);
    return;
  }
}

/**
 * Send click event to element
 */
function clickElement(msg) {
  var el;
  try {
    el = elementManager.getKnownElement([msg.json.element], win);
  }
  catch (e) {
    sendError(e.message, e.num, e.stack);
    return;
  }
  el.click();
  sendOk();
}

/**
 * Switch to frame given either the server-assigned element id,
 * its index in window.frames, or the iframe's name or id.
 */
function switchToFrame(msg) {
  var foundFrame = null;
  if ((msg.json.value == null) && (msg.json.element == null)) {
    win = content;
    activeFrame = null;
    content.focus();
    sendOk();
    return;
  }
  if (msg.json.element != undefined) {
    if (elementManager.seenItems[msg.json.element] != undefined) {
      var wantedFrame = elementManager.seenItems[msg.json.element]; //HTMLIFrameElement
      var numFrames = win.frames.length;
      for (var i = 0; i < numFrames; i++) {
        if (win.frames[i].frameElement == wantedFrame) {
          win = win.frames[i]; 
          activeFrame = i;
          win.focus();
          sendOk();
          return;
        }
      }
    }
  }
  switch(typeof(msg.json.value)) {
    case "string" :
      var foundById = null;
      var numFrames = win.frames.length;
      for (var i = 0; i < numFrames; i++) {
        //give precedence to name
        var frame = win.frames[i];
        var frameElement = frame.frameElement;
        if (frameElement.name == msg.json.value) {
          foundFrame = i;
          break;
        } else if ((foundById == null) && (frameElement.id == msg.json.value)) {
          foundById = i;
        }
      }
      if ((foundFrame == null) && (foundById != null)) {
        foundFrame = foundById;
      }
      break;
    case "number":
      if (win.frames[msg.json.value] != undefined) {
        foundFrame = msg.json.value;
      }
      break;
  }
  //TODO: implement index
  if (foundFrame != null) {
    var frameWindow = win.frames[foundFrame];
    activeFrame = foundFrame;
    win = frameWindow;
    win.focus();
    sendOk();
  } else {
    sendError("Unable to locate frame: " + msg.json.value, 8, null);
  }
}

//call register self when we get loaded
registerSelf();
