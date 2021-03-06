'use strict';

const TradeCalendar = require('../../lib/trade');
const moment = require('moment-timezone');

const config = {
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

describe('TradeCalendar', function () {
  let cn, us;
  before(function () {
    cn = TradeCalendar(Object.assign({
      timezoneName: 'Asia/Shanghai'
    }, config));
    us = new TradeCalendar(Object.assign({
      timezoneName: 'America/New_York'
    }, config));
  });

  describe('#timezoneName', () => {
    it('默认时区', () => {
      const c = TradeCalendar(config);
      c.timezoneName.should.be.eql(moment.tz.guess());
    });
  });

  describe('#timestamp()', function () {
    it('当前时间', () => {
      let now = Date.now();
      (parseInt(cn.timestamp() / 1000, 10) - parseInt(now / 1000, 10)).should.be.eql(0);
      (parseInt(us.timestamp() / 1000, 10) - parseInt(now / 1000, 10)).should.be.eql(0);
    });

    it('指定时间戳', () => {
      let now = Date.now();
      cn.timestamp(now).should.be.eql(now);
      us.timestamp(now).should.be.eql(now);
    });
  });

  describe('#currentTime()', function () {
    it('不同时区时间戳相同', function () {
      let t1 = cn.currentTime();
      let t2 = us.currentTime();
      moment(t1).diff(moment(t2)).should.be.eql(0);
    });

    it('不同时区时间相差', function () {
      let t1 = cn.currentTime('YYYY-MM-DD HH:mm:ss');
      let t2 = us.currentTime('YYYY-MM-DD HH:mm:ss');
      let z1 = parseInt(moment.tz('Asia/Shanghai').format('Z'), 10);
      let z2 = parseInt(moment.tz('America/New_York').format('Z'), 10);
      moment(t1).diff(moment(t2)).should.be.eql((z1 - z2) * 60 * 60 * 1000);
    });
  });

  describe('#moment()', function () {
    it('字符串', function () {
      cn.moment('2017-08-01 12:00:00').format().should.be.eql('2017-08-01T12:00:00+08:00');
      us.moment('2017-08-01 12:00:00').format().should.be.eql('2017-08-01T12:00:00-04:00');
    });

    it('时间戳', function () {
      cn.moment(1520417785432).format().should.be.eql('2018-03-07T18:16:25+08:00');
      us.moment(1520417785432).format().should.be.eql('2018-03-07T05:16:25-05:00');
    });

    it('对象', function () {
      cn.moment({
        year: 2010,
        month: 3,
        day: 5,
        hour: 15,
        minute: 10,
        second: 3,
        millisecond: 123
      }).format().should.be.eql('2010-04-05T15:10:03+08:00');
      us.moment({
        year: 2010,
        month: 3,
        day: 5,
        hour: 15,
        minute: 10,
        second: 3,
        millisecond: 123
      }).format().should.be.eql('2010-04-05T15:10:03-04:00');
    });
  });

  describe('#timeInfo()', function () {
    it('日历中最近的交易时间信息', async function () {
      (await cn.timeInfo(20170801)).should.be.eql({
        tradeDate: 20170801,
        timePeriods: [{
          start: 1501551000000,
          end: 1501574400000
        }],
        dayStart: 1501516800000,
        dayEnd: 1501603199999
      });
      (await us.timeInfo(20170801)).should.be.eql({
        tradeDate: 20170801,
        timePeriods: [{
          start: 1501594200000,
          end: 1501617600000
        }],
        dayStart: 1501560000000,
        dayEnd: 1501646399999
      });
    });

    it('日历中往历史最近交易时间信息', async function () {
      (await cn.timeInfo(20170801, -1)).should.be.eql({
        tradeDate: 20170801,
        timePeriods: [{
          start: 1501551000000,
          end: 1501574400000
        }],
        dayStart: 1501516800000,
        dayEnd: 1501603199999
      });
      (await us.timeInfo(20170801, -1)).should.be.eql({
        tradeDate: 20170801,
        timePeriods: [{
          start: 1501594200000,
          end: 1501617600000
        }],
        dayStart: 1501560000000,
        dayEnd: 1501646399999
      });
    });

    it('非交易日-日历中往历史最近交易时间信息', async function () {
      (await cn.timeInfo(20170730, 1)).should.be.eql({
        tradeDate: 20170731,
        timePeriods: [{
          start: 1501464600000,
          end: 1501488000000
        }],
        dayStart: 1501430400000,
        dayEnd: 1501516799999
      });
      (await us.timeInfo(20170730, 1)).should.be.eql({
        tradeDate: 20170731,
        timePeriods: [{
          start: 1501507800000,
          end: 1501531200000
        }],
        dayStart: 1501473600000,
        dayEnd: 1501559999999
      });
    });
  });

  describe('#realTimeInfo()', function () {
    it('实际的交易时间信息', async function () {
      (await cn.realTimeInfo(20170801)).should.be.eql({
        tradeDate: 20170801,
        timePeriods: [{
          start: 1501551000000,
          end: 1501574400000
        }],
        dayStart: 1501516800000,
        dayEnd: 1501603199999
      });
      (await us.realTimeInfo(20170801)).should.be.eql({
        tradeDate: 20170801,
        timePeriods: [{
          start: 1501594200000,
          end: 1501617600000
        }],
        dayStart: 1501560000000,
        dayEnd: 1501646399999
      });
    });
  });

  describe('#formatTimeInfo()', function () {
    it('格式化交易信息', async function () {
      cn.formatTimeInfo(await cn.timeInfo(20170801)).should.be.eql({
        'tradeDate': 20170801,
        'timePeriods': [{
          'start': '2017-08-01T09:30:00+08:00',
          'end': '2017-08-01T16:00:00+08:00'
        }],
        'dayStart': '2017-08-01T00:00:00+08:00',
        'dayEnd': '2017-08-01T23:59:59+08:00'
      });
      us.formatTimeInfo(await us.timeInfo(20170801)).should.be.eql({
        tradeDate: 20170801,
        timePeriods: [{
          start: '2017-08-01T09:30:00-04:00',
          end: '2017-08-01T16:00:00-04:00'
        }],
        dayStart: '2017-08-01T00:00:00-04:00',
        dayEnd: '2017-08-01T23:59:59-04:00'
      });
    });
  });

  it('setTimeout', (done) => {
    let st = Date.now();
    us.setTimeout(() => {
      let cost = Date.now() - st;
      (cost > 450 && cost < 550).should.be.ok();
      done();
    }, 500);
  });

  it('setTimeoutAt', (done) => {
    let st = Date.now();
    let time = us.moment().add(500, 'milliseconds').valueOf();
    us.setTimeoutAt(() => {
      let cost = Date.now() - st;
      (cost > 450 && cost < 550).should.be.ok();
      done();
    }, time);
  });
});