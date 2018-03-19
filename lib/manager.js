'use strict';

const EventEmitter = require('events');
const moment = require('moment-timezone');

const emptyLog = () => {};

const DEFAULT_LOGGER = {
  error: console.error.bind(console),
  warn: emptyLog,
  info: emptyLog,
  debug: emptyLog,
  trace: emptyLog
};

class CalendarManager extends EventEmitter {

  constructor(options) {
    super();
    options = options || {};
    const logger = this.log = options.logger || {};
    Object.keys(DEFAULT_LOGGER).forEach(name => {
      if (!logger[name]) {
        logger[name] = DEFAULT_LOGGER[name];
      }
    });
    this.calendars = {};
  }

  async start(name, calendar) {
    if (typeof name !== 'string') {
      calendar = name;
      name = calendar.name;
    }
    if (this.calendars[name] && calendar && this.calendars[name] !== calendar) {
      throw {
        code: 'REPEAT_NAME',
        message: '重复日历名称'
      };
    }
    if (calendar) {
      this.calendars[name] = calendar;
    } else {
      calendar = this.calendars[name];
    }
    await this.setTimeInfo(name, 0);
  }

  stop(name) {
    const calendar = this.calendars[name];
    if (!calendar) return;
    this.log.debug('[%s] stoped at =>', name, calendar.currentTime());
    if (calendar._timeInfoHandler) {
      clearTimeout(calendar._timeInfoHandler);
    }
    if (calendar._startTimeHandler) {
      clearTimeout(calendar._startTimeHandler);
    }
    if (calendar._endTimeHandler) {
      clearTimeout(calendar._endTimeHandler);
    }
  }

  stopAll() {
    Object.keys(this.calendars).forEach(name => {
      this.stop(name);
    });
  }

  async setTimeInfo(name, start, retry) {
    const self = this;
    const calendar = this.calendars[name];
    const logger = this.log;
    logger.debug('[%s] start set trade time(%s) => %s', name, calendar.currentTime(), calendar.tradeDate);
    try {
      let timeInfo = await calendar.realTimeInfo(start);
      logger.debug('[%s] current trade time: %s', name, calendar.strTimeInfo(timeInfo));
      if (calendar.tradeDate !== timeInfo.tradeDate) {
        if (calendar.tradeDate > 0) {
          calendar.preTradeDate = calendar.tradeDate;
        } else {
          let ti = await calendar.realTimeInfo(moment(timeInfo.tradeDate.toString()).subtract(1, 'day').format('YYYYMMDD'), -1);
          calendar.preTradeDate = ti.tradeDate;
          logger.info('[%s] previous trade time: %s', name, calendar.strTimeInfo(ti));
        }
        let nd = await calendar.getTimeInfo(moment(timeInfo.tradeDate.toString()).add(1, 'day').format('YYYYMMDD'), 1);
        logger.info('[%s] next trade time: %s', name, calendar.strTimeInfo(nd));
        calendar.nextTradeDate = nd.tradeDate;
        calendar.tradeDate = timeInfo.tradeDate;
        calendar.dayStart = timeInfo.dayStart;
        calendar.dayEnd = timeInfo.dayEnd;
        logger.info('[%s] trade date change =>', name, timeInfo.tradeDate, calendar.preTradeDate, calendar.nextTradeDate);
        this.emit('trade-date-change', calendar, timeInfo.tradeDate, calendar.preTradeDate, calendar.nextTradeDate);
      }
      calendar.systemPeriods = timeInfo.timePeriods;
      this.changeSystemPeriod(name, calendar);
      if (calendar._timeInfoHandler) {
        clearTimeout(calendar._timeInfoHandler);
      }
      calendar._timeInfoHandler = calendar.setTimeoutAt(async () => {
        logger.info('[%s] after market close =>', name, calendar.tradeDate);
        self.emit('after-market-close', calendar, calendar.tradeDate);
        await self.setTimeInfo(name, moment(calendar.tradeDate.toString()).add(1, 'days').format('YYYYMMDD'));
      }, calendar.afterMarketEnd(timeInfo.tradeDate));
    } catch (err) {
      logger.error('[%s] set time error =>', name, retry, err);
      if (retry) {
        if (calendar._timeInfoHandler) {
          clearTimeout(calendar._timeInfoHandler);
          calendar._timeInfoHandler = null;
        }
        // 10秒之后重试
        calendar._timeHandler = setTimeout(async () => {
          await self.setTimeInfo(name, start, retry);
        }, 10 * 1000);
      } else {
        throw err;
      }
    }
  }

  changeSystemPeriod(name, calendar) {
    const self = this;
    const logger = self.log;
    if (calendar.systemPeriods.length > 0) { // 当天还有交易时间段
      calendar.systemPeriod = calendar.systemPeriods.shift(); // 取出最近一个交易时间段
      self.emit('system-period-change', calendar, calendar.systemPeriod, calendar.systemPeriods);
      logger.debug('[%s] system-period-change =>', name, calendar.systemPeriod);
      if (calendar._startTimeHandler) {
        clearTimeout(calendar._startTimeHandler);
      }
      if (calendar._endTimeHandler) {
        clearTimeout(calendar._endTimeHandler);
      }
      calendar._startTimeHandler = calendar.realTimeoutAt(() => {
        self.emit('system-time-start', calendar, calendar.systemPeriod);
        logger.debug('[%s] system-time-start =>', name, calendar.systemPeriod);
      }, calendar.systemPeriod.start);
      calendar._endTimeHandler = calendar.realTimeoutAt(() => { // 在当前交易时间段结束段时候去取下个交易时间段
        self.emit('system-time-end', calendar, calendar.systemPeriod);
        logger.debug('[%s] system-time-end =>', name, calendar.systemPeriod);
        self.changeSystemPeriod(name, calendar);
      }, calendar.systemPeriod.end);
    }
  }
}

module.exports = CalendarManager;