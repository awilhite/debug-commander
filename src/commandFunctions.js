const ping = require("ping");

_ping = function () {};

module.exports = {
  ping: {
    func: ping.promise.probe,
    formatResponse: function (res) {
      return res.alive.toString();
    },
  },
  timestamp: {
    func: () => {
      let posixTimeMilliseconds = Date.now();
      let posixTimeSeconds = parseInt(posixTimeMilliseconds / 1000);
      return posixTimeSeconds.toString();
    },
  },
  absdiff: {
    func: (arg1, arg2) => {
      return Math.abs(parseInt(arg1) - parseInt(arg2)).toString();
    },
  },
};
