'use strict';

const Calendar = require('../../lib/virtual');
const CalendarManager = require('../../lib/manager');
const moment = require('moment-timezone');

const config = {
  virtual: {},
  before: {
    start: {
      hour: 8,
      minute: 5,
      second: 0,
      millisecond: 0
    },
    end: {
      hour: 9,
      minute: 25,
      second: 0,
      millisecond: 0
    }
  },
  start: {
    hour: 9,
    minute: 30,
    second: 0,
    millisecond: 0
  },
  end: {
    hour: 16,
    minute: 0,
    second: 0,
    millisecond: 0
  },
  after: {
    start: {
      hour: 16,
      minute: 5,
      second: 0,
      millisecond: 0
    },
    end: {
      hour: 17,
      minute: 25,
      second: 0,
      millisecond: 0
    }
  }
};

describe('CalendarManager', function () {
  let calendar, manager;
  before(async () => {
    let m = moment();
    calendar = new Calendar(Object.assign({}, config, {
      timezoneName: 'Asia/Shanghai',
      startTime: m.valueOf(),
      virtual: {
        strategy: 'START',
        standard: m.subtract(1, 'days').format('YYYY-MM-DD HH:mm:ss.SSS')
      }
    }));
    manager = new CalendarManager();
    await manager.start(calendar);
  });
  after(() => {
    if (manager) {
      manager.stopAll();
    }
  });

  describe('#timezoneName', () => {
    it('默认时区', () => {
      const c = Calendar(config);
      c.timezoneName.should.be.eql(moment.tz.guess());
    });
  });
});