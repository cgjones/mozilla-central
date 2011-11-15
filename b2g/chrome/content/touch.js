
(function touchEventHandler() {
  let contextMenuTimeout = 0;

  let TouchEventHandler = {
    events: ['mousedown', 'mousemove', 'mouseup', 'mouseout',
             'unload', 'contextmenu'],
    start: function teh_start() {
      this.events.forEach((function(evt) {
        shell.home.addEventListener(evt, this, true);
      }).bind(this));
    },
    stop: function teh_stop() {
      this.events.forEach((function(evt) {
        shell.home.removeEventListener(evt, this, true);
      }).bind(this));
    },
    handleEvent: function teh_handleEvent(evt) {
      let eventTarget = this.target;

      let type = '';
      switch (evt.type) {
        case 'mousedown':
          this.target = evt.target;
          this.timestamp = evt.timeStamp;
          evt.target.setCapture(false);
          type = 'touchstart';
          break;
        case 'mousemove':
          // On device a mousemove event if fired right after the mousedown
          // because of the size of the finger, so let's ignore what happens
          // below 5ms
          if (evt.timeStamp - this.timestamp < 5) {
            let x = evt.pageX;
            let y = evt.pageY;
            let event = evt.target.ownerDocument.createEvent("MouseEvent");
            event.initMouseEvent("contextmenu", true, true, content,
                                 0, x, y, x, y, false, false, false, false,
                                 0, null);
            event.x = x;
            event.y = y;
            contextMenuTimeout = window.setTimeout(function contextMenu() {
              evt.target.dispatchEvent(event);
            }, 2000);
            return;
          }
          window.clearTimeout(contextMenuTimeout);
          type = 'touchmove';
          break;
        case 'mouseup':
          this.target = null;
          document.releaseCapture();
          type = 'touchend';
          break;
        case 'mouseout':
          if (evt.relatedTarget)
            return;
          this.target = null;
          document.releaseCapture();
          type = 'touchcancel';
          break;
        case 'unload':
          TouchEventHandler.stop();
          return;
        case 'contextmenu':
          this.target = null;
          document.releaseCapture();
          return;
      }

      let target = eventTarget || this.target;
      if (target) {
        this.sendTouchEvent(evt, target, type);
        evt.stopPropagation();
      }
    },
    sendTouchEvent: function teh_sendTouchEvent(evt, target, name) {
      let touchEvent = document.createEvent("touchevent");
      let point = document.createTouch(window, target, 0,
                                     evt.pageX, evt.pageY,
                                     evt.screenX, evt.screenY,
                                     evt.clientX, evt.clientY,
                                     1, 1, 0, 0);
      let touches = document.createTouchList(point);
      let targetTouches = touches;
      let changedTouches = touches;
      touchEvent.initTouchEvent(name, true, true, window, 0,
                                false, false, false, false,
                                touches, targetTouches, changedTouches);
      return target.dispatchEvent(touchEvent);
    }
  };

  window.addEventListener('load', function touchStart(evt) {
    window.removeEventListener('load', touchStart, true);
    shell.home.addEventListener('load', function contentStart(evt) {
      shell.home.removeEventListener('load', contentStart);
      TouchEventHandler.start();
    }, true);
  }, true);
})();

