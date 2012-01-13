/* ***** BEGIN LICENSE BLOCK *****
 * Version: MPL 1.1/GPL 2.0/LGPL 2.1
 *
 * The contents of this file are subject to the Mozilla Public License Version
 * 1.1 (the "License"); you may not use this file except in compliance with
 * the License. You may obtain a copy of the License at
 * http://www.mozilla.org/MPL/
 *
 * Software distributed under the License is distributed on an "AS IS" basis,
 * WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License
 * for the specific language governing rights and limitations under the
 * License.
 *
 * The Original Code is mozilla.org code.
 *
 * The Initial Developer of the Original Code is
 *   Mozilla Foundation
 * Portions created by the Initial Developer are Copyright (C) 2011
 * the Initial Developer. All Rights Reserved.
 *
 * Contributor(s):
 *    Malini Das (mdas@mozilla.com)
 *    Jonathan Griffin (jgriffin@mozilla.com)
 *
 * Alternatively, the contents of this file may be used under the terms of
 * either the GNU General Public License Version 2 or later (the "GPL"), or
 * the GNU Lesser General Public License Version 2.1 or later (the "LGPL"),
 * in which case the provisions of the GPL or the LGPL are applicable instead
 * of those above. If you wish to allow use of your version of this file only
 * under the terms of either the GPL or the LGPL, and not to allow others to
 * use your version of this file under the terms of the MPL, indicate your
 * decision by deleting the provisions above and replace them with the notice
 * and other provisions required by the GPL or the LGPL. If you do not delete
 * the provisions above, a recipient may use your version of this file under
 * the terms of any one of the MPL, the GPL or the LGPL.
 *
 * ***** END LICENSE BLOCK ***** */

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

var prefs = Cc["@mozilla.org/preferences-service;1"]
            .getService(Ci.nsIPrefBranch);
prefs.setBoolPref("marionette.contentListener", false);

var xulAppInfo = Cc["@mozilla.org/xre/app-info;1"]
                 .getService(Ci.nsIXULAppInfo);
var isB2G = xulAppInfo.name.indexOf('B2G') > -1;

if (isB2G) {
  // prevent 'slow script' dialogs
  prefs.setIntPref("dom.max_script_run_time", 180);
}

Cu.import("resource:///modules/marionette-logger.jsm");
MarionetteLogger.write('marionette-actors.js loaded');

function createRootActor(aConnection)
{
  return new MarionetteRootActor(aConnection);
}

function MarionetteRootActor(aConnection)
{
  this.conn = aConnection;
  /* will only ever be one marionette actor */
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

  disconnect: function MRA_disconnect() {
    this._marionetteActor.deleteSession();
  },

  /* used to get the running marionette actor, so we can issue commands */
  getMarionetteID: function MRA_getMarionette() {
    return { "from": "root",
             "id": this._marionetteActor.actorID } ;
  },
}

MarionetteRootActor.prototype.requestTypes = {
  "getMarionetteID": MarionetteRootActor.prototype.getMarionetteID,
  "sayHello": MarionetteRootActor.prototype.sayHello
};

function MarionetteDriverActor(aConnection)
{
  this.conn = aConnection;
  this.messageManager = Cc["@mozilla.org/globalmessagemanager;1"].
                             getService(Ci.nsIChromeFrameMessageManager);
  this.messageManager.addMessageListener("Marionette:ok", this);
  this.messageManager.addMessageListener("Marionette:done", this);
  this.messageManager.addMessageListener("Marionette:error", this);
  this.messageManager.addMessageListener("Marionette:log", this);
  this.windowMediator = Cc['@mozilla.org/appshell/window-mediator;1'].getService(Ci.nsIWindowMediator);
  this.browser = null;
  this.tab = null;
  this.context = "content";
  this.scriptTimeout = null;
  this.timer = null;
}

MarionetteDriverActor.prototype = {

  actorPrefix: "marionette",

  sendResponse: function (value) {
    this.conn.send({from:this.actorID, value: value});
  },

  sendOk: function() {
    this.conn.send({from:this.actorID, ok: true});
  },

  sendError: function (message, status, trace) {
    var error_msg = {message: message, status: status, stacktrace: trace};
    this.conn.send({from:this.actorID, error: error_msg});
  },

  getCurrentWindow: function() {
    var type = null;
    if (!isB2G) {
      type = 'navigator:browser';
    }
    return this.windowMediator.getMostRecentWindow(type);
  },

  //We will only ever be running one browser at a time
  //If no browser is running (ie: in B2G) start one up
  newSession: function MDA_newSession(aRequest) {
    this.browser = new BrowserObj(this.getCurrentWindow());
    this.browser.startSession();
    this.browser.loadFrameScript("resource:///modules/marionette-listener.js");
    this.tab = this.browser.tab;
    this.messageManager.sendAsyncMessage("Marionette:newSession", {B2G: isB2G});
  },

  setContext: function MDA_setContext(aRequest) {
    var context = aRequest.value;
    if (context != "content" && context != "chrome") {
      this.sendError("invalid context", 17, null); //TODO find more appropriate errmsg
    }
    else {
      this.context = context;
      this.sendOk();
    }
  },

  execute: function MDA_execute(aRequest, directInject) {
    if (this.context == "chrome") {
      var curWindow = this.getCurrentWindow();
      try {
        Marionette.is_async = false;
        Marionette.tests = [];
        Marionette.context = "chrome";
        var params = aRequest.args;
        var _chromeSandbox = new Cu.Sandbox(curWindow,
           { sandboxPrototype: curWindow, wantXrays: false, 
             sandboxName: ''});
        _chromeSandbox.Marionette = Marionette;
        if (directInject) {
          //run the given script directly
          var res = Cu.evalInSandbox(aRequest.value, _chromeSandbox);
          if (res == undefined || res.passed == undefined) {
            this.sendError("Marionette.finish() not called", 17, null);
          }
          else {
            this.sendResponse(res);
          }
        }
        else {
          _chromeSandbox.__marionetteParams = params;
          var script = "var func = function() {" + aRequest.value + "}; func.apply(null, __marionetteParams);";
          var res = Cu.evalInSandbox(script, _chromeSandbox);
          this.sendResponse(res);
        }
      }
      catch (e) {
        // 17 = JavascriptException
        this.sendError(e.name + ': ' + e.message, 17, e.stack);
      }
      Marionette.reset();
    }
    else {
      this.messageManager.sendAsyncMessage("Marionette:executeScript", {value: aRequest.value, args: aRequest.args});
    }
  },

  setScriptTimeout: function MDA_setScriptTimeout(aRequest) {
    var timeout = parseInt(aRequest.value);
    if(isNaN(timeout)){
      this.sendError("Not a Number", 17, null); //TODO: find more appropriate error message
    }
    else {
      this.scriptTimeout = timeout;
      this.messageManager.sendAsyncMessage("Marionette:setScriptTimeout", {value: timeout});
      this.sendOk();
    }
  },

  executeAsync: function MDA_executeAsync(aRequest) {
    this.executeWithCallback(aRequest);
  },

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
      this.messageManager.sendAsyncMessage("Marionette:executeJSScript", {value:aRequest.value, args:aRequest.args, timeout:aRequest.timeout});
   }
  },

  executeWithCallback: function MDA_executeWithCallback(aRequest, timeout) {
    if (this.context == "chrome") {
      try {
        var curWindow = this.getCurrentWindow();
        Marionette.tests = [];
        Marionette.is_async = true;
        Marionette.context = "chrome";
        Marionette.__conn = this.conn;
        Marionette.__actorID = this.actorID;
        this.timer = Cc["@mozilla.org/timer;1"].createInstance(Ci.nsITimer);
        Marionette.__timer = this.timer;
        var params = aRequest.args;
        var _chromeSandbox = new Cu.Sandbox(curWindow,
           { sandboxPrototype: curWindow, wantXrays: false, sandboxName: ''});
        _chromeSandbox.__marionetteParams = params;
        _chromeSandbox.Marionette = Marionette;
        var script;
        var timeoutScript = 'var timeoutFunc = function() {Marionette.returnFunc("timed out", 28);};'
                           + 'if(Marionette.__timer != null) {Marionette.__timer.initWithCallback(timeoutFunc, '+ this.scriptTimeout +', Components.interfaces.nsITimer.TYPE_ONE_SHOT);}';
        if (timeout) {
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
        Cu.evalInSandbox(script, _chromeSandbox);
      } catch (e) {
        this.sendError(e.name + ": " + e.message, 17, e.stack);
      }
    }
    else {
      this.messageManager.sendAsyncMessage("Marionette:executeAsyncScript", {value: aRequest.value, args: aRequest.args});
    }
  },

  goUrl: function MDA_goUrl(aRequest) {
    this.browser.loadURI(aRequest.value, this);
  },

  getUrl: function MDA_getUrl(aRequest) {
    this.messageManager.sendAsyncMessage("Marionette:getUrl", {});
  },

  goBack: function MDA_goBack(aRequest) {
    this.messageManager.sendAsyncMessage("Marionette:goBack", {});
  },

  goForward: function MDA_goForward(aRequest) {
    this.messageManager.sendAsyncMessage("Marionette:goForward", {});
  },

  refresh: function MDA_refresh(aRequest) {
    this.messageManager.sendAsyncMessage("Marionette:refresh", {});
  },

  setSearchTimeout: function MDA_setSearchTimeout(aRequest) {
    this.messageManager.sendAsyncMessage("Marionette:setSearchTimeout", {value: aRequest.value});
  },

  findElement: function MDA_findElement(aRequest) {
    this.messageManager.sendAsyncMessage("Marionette:findElement", {value: aRequest.value, using: aRequest.using, element: aRequest.element});
  },

  clickElement: function MDA_clickElement(aRequest) {
    this.messageManager.sendAsyncMessage("Marionette:clickElement", {element: aRequest.element});
  },

  deleteSession: function MDA_deleteSession(aRequest) {
    this.browser.closeTab();
    this.tab = null;
    if (!isB2G) {
      this.messageManager.sendAsyncMessage("Marionette:deleteSession", {});
      //don't set this pref for B2G since the framescript can be safely reused
      prefs.setBoolPref("marionette.contentListener", false);
    }
    this.messageManager.removeMessageListener("Marionette:ok", this);
    this.messageManager.removeMessageListener("Marionette:done", this);
    this.messageManager.removeMessageListener("Marionette:error", this);
    this.messageManager.removeMessageListener("Marionette:log", this);
    this.sendOk();
  },

  receiveMessage: function(message) {
    if (message.name == "DOMContentLoaded") {
      this.sendOk();
      this.messageManager.removeMessageListener("DOMContentLoaded", this, true);
    }
    else if (message.name == "Marionette:done") {
      this.sendResponse(message.json.value);
    }
    else if (message.name == "Marionette:ok") {
      this.sendOk();
    }
    else if (message.name == "Marionette:error") {
      this.sendError(message.json.message, message.json.status, message.json.stacktrace);
    }
    else if (message.name == "Marionette:log") {
      MarionetteLogger.write(message.json.message);
    }
  },

  /* for non-e10s eventListening */
  handleEvent: function(evt) {
    if (evt.type == "DOMContentLoaded") {
      this.sendOk();
      this.browser.removeEventListener("DOMContentLoaded", this, true);
    }
  },
};

MarionetteDriverActor.prototype.requestTypes = {
  "newSession": MarionetteDriverActor.prototype.newSession,
  "setContext": MarionetteDriverActor.prototype.setContext,
  "executeScript": MarionetteDriverActor.prototype.execute,
  "setScriptTimeout": MarionetteDriverActor.prototype.setScriptTimeout,
  "executeAsyncScript": MarionetteDriverActor.prototype.executeAsync,
  "executeJSScript": MarionetteDriverActor.prototype.executeJSScript,
  "setSearchTimeout": MarionetteDriverActor.prototype.setSearchTimeout,
  "findElement": MarionetteDriverActor.prototype.findElement,
  "clickElement": MarionetteDriverActor.prototype.clickElement,
  "goUrl": MarionetteDriverActor.prototype.goUrl,
  "getUrl": MarionetteDriverActor.prototype.getUrl,
  "goBack": MarionetteDriverActor.prototype.goBack,
  "goForward": MarionetteDriverActor.prototype.goForward,
  "refresh":  MarionetteDriverActor.prototype.refresh,
  "deleteSession": MarionetteDriverActor.prototype.deleteSession
};

function BrowserObj(win) {
  this.DESKTOP = "desktop";
  this.B2G = "B2G";
  this.FENNEC = "fennec";
  this.browser;
  this.browser_mm;
  this.tab = null;
  this.messageManager = Cc["@mozilla.org/globalmessagemanager;1"].
                             getService(Ci.nsIChromeFrameMessageManager);
  if (win.gBrowser != undefined) {
    this.type = this.DESKTOP; 
    this.browser = win.gBrowser; 
  }
  else if (win.Browser != undefined) {
    this.type = this.FENNEC;
    this.browser = win.Browser; //BrowserApp for birch?
  }
  else {
    this.type = this.B2G; //TODO: no browser support yet
  }
}

BrowserObj.prototype = {
  startSession: function BO_startSession() {
    if (this.type == this.B2G) {
      return;
    }
    this.addTab("about:blank");
    if (this.type == this.DESKTOP) {
      this.browser.selectedTab = this.tab;
      var newTabBrowser = this.browser.getBrowserForTab(this.tab);
      newTabBrowser.ownerDocument.defaultView.focus(); //focus the tab
      this.browser_mm = this.browser.getBrowserForTab(this.tab).messageManager;
    }
    else {
      this.browser_mm = this.tab.browser.messageManager;
    }
  },
  closeTab: function BO_closeTab() {
    if (this.tab != null) {
      switch (this.type) {
        case this.DESKTOP:
          this.browser.removeTab(this.tab);
          break;
        case this.B2G:
          //TODO
          return;
        default: 
          this.browser.closeTab(this.tab);
      }
      this.tab = null;
    }
  },
  addTab: function BO_addTab(uri) {
    this.tab = this.browser.addTab(uri, true);
  },
  loadURI: function BO_openURI(uri, listener) {
    if (this.type == this.DESKTOP) {
      this.browser.addEventListener("DOMContentLoaded", listener, true);
      this.browser.loadURI(uri);
    }
    else {
      this.messageManager.addMessageListener("DOMContentLoaded", listener, true);
      this.browser.selectedBrowser.loadURI(uri);
    }
  },
  loadFrameScript: function BO_loadFrameScript(script) {
    if (!prefs.getBoolPref("marionette.contentListener")) {
      /* we only need one instance of each listener running in content space */
      if (this.type == this.B2G) {
        this.messageManager.loadFrameScript(script, false);
      }
      else {
        this.browser_mm.loadFrameScript(script, false);
      }
      prefs.setBoolPref("marionette.contentListener", true);
    }
  },
}
