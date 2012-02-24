/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

const {classes: Cc, interfaces: Ci, utils: Cu, results: Cr} = Components;

Cu.import("resource://gre/modules/XPCOMUtils.jsm");
Cu.import("resource://gre/modules/Services.jsm");
Cu.import("resource://gre/modules/EventTarget.jsm");

const MOBILECONNECTION_CID = Components.ID("{75e6e937-d628-4047-9ca3-fa93d360babb}");
const MOBILECONNECTION_CONTRACTID = "@mozilla.org/dom/mobileconnection;1";

function MobileConnection() {
}
MobileConnection.prototype = {

  __proto__: EventTarget.prototype,

  classID: MOBILECONNECTION_CID,
  QueryInterface: XPCOMUtils.generateQI([Ci.nsIDOMGlobalPropertyInitializer,
                                         Ci.nsIDOMMozMobileConnection,
                                         Ci.nsIDOMEventTarget,
                                         Ci.nsISupportsWeakReference,
                                         Ci.nsIObserver]),
  classInfo: XPCOMUtils.generateCI({classID:    MOBILECONNECTION_CID,
                                    contractID: MOBILECONNECTION_CONTRACTID,
                                    interfaces: [Ci.nsIDOMMozMobileConnection,
                                                 Ci.nsIDOMEventTarget],
                                    flags:      Ci.nsIClassInfo.DOM_OBJECT,
                                    classDescription: "MobileConnection"}),

  // nsIDOMGlobalPropertyInitializer

  mRIL: null,

  init: function(window) {
    this.window = window;
    this.mRIL = Cc["@mozilla.org/telephony/system-worker-manager;1"]
                  .getService(Ci.nsIInterfaceRequestor)
                  .getInterface(Ci.nsIRadioInterfaceLayer);
    // Do a weak ref so we don't have to unregister ourselves.
    Services.obs.addObserver(this, "ril-radiostate-changed", true);

    // Set up initial state.
    let radioState = this.mRIL.radioState;
    this.cardState = radioState.cardState;
    for each (let attr in this._connection_attrs) {
      this[attr] = radioState[attr];
    }
  },

  // nsIObserver

  observe: function observe(subject, topic, data) {
    debug("Observed notification " + topic);
    let radioState = this.mRIL.radioState;
    if (this.cardState != radioState.cardState) {
      this.cardState = radioState.cardState;
      this._dispatchEventByType("cardchange");
    }

    let needEvent = false;
    for each (let attr in this._connection_attrs) {
      if (this[attr] != radioState[attr]) {
        this[attr] = radioState[attr];
        needEvent = true;
        debug("Radio state (" + attr + ") changed.");
      }
    }
    if (needEvent) {
      this._dispatchEventByType("connectionchange");
    }
  },

  _connection_attrs: ["connected", "roaming", "operator", "type",
                      "signalStrength", "bars"],

  _dispatchEventByType: function _dispatchEventByType(type) {
    let event = this.window.document.createEvent("Event");
    event.initEvent(type, false, false);
    //event.isTrusted = true;
    this.dispatchEvent(event);
  },

  // nsIDOMMozMobileConnection

  cardState:      null,
  connected:      false,
  roaming:        false,
  operator:       null,
  type:           null,
  signalStrength: null,
  bars:           null,

};
defineEventListenerSlot(MobileConnection.prototype, "cardstatechange");
defineEventListenerSlot(MobileConnection.prototype, "connectionchange");

const NSGetFactory = XPCOMUtils.generateNSGetFactory([MobileConnection]);


function debug(s) {
  dump(s + "\n");
}
