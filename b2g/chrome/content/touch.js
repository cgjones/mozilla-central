
(function touchEventHandler() {
  let contextMenuTimeout = 0;

  let TouchEventHandler = {
    events: ['mousedown', 'mousemove', 'mouseup', 'unload'],
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
          contextMenuTimeout =
            this.sendContextMenu(evt.target, evt.pageX, evt.pageY, 2000);
          this.startX = evt.pageX;
          this.startY = evt.pageY;
          type = 'touchstart';
          break;
        case 'mousemove':
          if (!eventTarget)
            return;

          // On device a mousemove event if fired right after the mousedown
          // because of the size of the finger, so let's ignore what happens
          // below 5ms
          if (evt.timeStamp - this.timestamp < 30)
            break;

          if (Math.abs(this.startX - evt.pageX) > 15 ||
              Math.abs(this.startY - evt.pageY) > 15)
            window.clearTimeout(contextMenuTimeout);
          type = 'touchmove';
          break;
        case 'mouseup':
          if (!eventTarget)
            return;

          window.clearTimeout(contextMenuTimeout);
          eventTarget.ownerDocument.releaseCapture();
          this.target = null;
          type = 'touchend';
          break;
        case 'unload':
          window.clearTimeout(contextMenuTimeout);
          eventTarget.ownerDocument.releaseCapture();
          this.target = null;
          TouchEventHandler.stop();
          return;
      }

      let target = eventTarget || this.target;
      if (target && type) {
        this.sendTouchEvent(evt, target, type);
        evt.stopPropagation();
      } else {
        evt.preventDefault();
        evt.stopPropagation();
      }
    },
    sendContextMenu: function teh_sendContextMenu(target, x, y, delay) {
      let doc = target.ownerDocument;
      let evt = doc.createEvent("MouseEvent");
      evt.initMouseEvent("contextmenu", true, true, doc.defaultView,
                         0, x, y, x, y, false, false, false, false,
                         0, null);

      let timeout = window.setTimeout((function contextMenu() {
        target.dispatchEvent(evt);
        if (!evt.getPreventDefault())
          return;

        doc.releaseCapture();
        this.target = null;

        shell.home.addEventListener('click', function handleClick(evt) {
          shell.home.removeEventListener('click', handleClick, true);
          evt.preventDefault();
          evt.stopPropagation();
        }, true);
      }).bind(this), delay);
      return timeout;
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

