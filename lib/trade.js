'use strict';

const _ = require('lodash');
const moment = require('moment-timezone');

/**
 * 时间点
 * @typedef {Object} TimePoint
 * @property {Number} hour 时
 * @property {Number} minute 分
 * @property {Number} second 秒
 * @property {Number} millisecond 毫秒
 */
/**
 * 时间区间
 *
 * @typedef {object} TimePeriod
 * @property {number} start 开始时间戳(毫秒)
 * @property {number} end 结束时间戳(毫秒)
 */
/**
 * 时间信息
 *
 * @typedef {object} TimeInfo
 * @property {number} tradeDate 8位整型日期
 * @property {Array.<TimePeriod>} timePeriods 交易时间段
 * @property {number} dayStart 日期开始时间戳(毫秒,0点时间戳)
 * @property {number} dayEnd 日期结束时间戳(毫秒,23:59:59.999时间戳)
 */

const emptyHolidayFinder = async function () {
  return [];
};

/**
 * 时间段
 * @typedef {{}} ConfigPeriod
 * @property {TimePoint} start 时间段开始
 * @property {TimePoint} end 时间段结束
 */

/**
 * 时间配置
 * @typedef {{}} CalendarConfig
 * @property {ConfigPeriod} before 盘前时间段
 * @property {ConfigPeriod} after 盘盘后时间段
 * @property {TimePoint} start 盘中开始时间
 * @property {TimePoint} end 盘中结束时间
 */

/**
 * 交易日历
 *
 * @param {CalendarConfig} config 时间配置
 * @param {GeneratorFunction} holidayFinder 查找节假日函数
 * @constructor
 */
function TradeCalendar(config, holidayFinder) {
  if (!(this instanceof TradeCalendar)) return new TradeCalendar(config, holidayFinder);
  /**
   * 启动时间
   * @member {number}
   */
  this.startTime = config.startTime && config.startTime.valueOf && config.startTime.valueOf() || config.startTime || Date.now();
  this._config = _.cloneDeep(config);
  this.name = this._config.name || 'trade';
  this._setTimeout = config.setTimeout || setTimeout;
  this.tradeDate = 0;
  this.nextTradeDate = 0;
  this.dayStart = 0;
  this.dayEnd = 0;
  this._holidayFinder = holidayFinder || emptyHolidayFinder;
  this.reload({});
}

/**
 * 重新加载配置
 * @param {CalendarConfig} config 时间配置
 * @param {GeneratorFunction} [holidayFinder] 查找节假日函数
 */
TradeCalendar.prototype.reload = function (config, holidayFinder) {
  _.merge(this._config, _.cloneDeep(config));
  if (config.startTime) {
    this.startTime = config.startTime && config.startTime.valueOf && config.startTime.valueOf() || config.startTime;
  }
  this.timezoneName = this._config.timezoneName;
  if (!this.timezoneName) {
    this.timezoneName = moment.tz.guess();
  }
  if (config.setTimeout) {
    this._setTimeout = config.setTimeout;
  }
  if (holidayFinder) {
    this._holidayFinder = holidayFinder;
  }
};

TradeCalendar.prototype.timezone = function () {
  return moment.tz(this.timezoneName).utcOffset() / 60;
};

TradeCalendar.prototype.now = function () {
  return Date.now();
};

/**
 * 根据实际时间计算日历中的时间戳
 *
 * @param {number|Date|Moment} [time] 实际时间
 * @returns {number} 日历时间戳
 */
TradeCalendar.prototype.timestamp = function (time) {
  return time && time.valueOf && time.valueOf() || time || Date.now();
};

/**
 * @returns {moment|Moment} 日历中的moment时间
 */
TradeCalendar.prototype.moment = function () {
  const m = moment.apply(moment, arguments);
  const v = (!arguments[0] || typeof arguments[0] === 'number') ? m.valueOf() : m.format('YYYY-MM-DD HH:mm:ss.SSS');
  return moment.tz(v, this.timezoneName);
};

/**
 * @returns {moment|Moment} 日历中的时间转化成日历中的moment
 */
TradeCalendar.prototype.toMoment = function () {
  const m = moment.apply(moment, arguments);
  const v = typeof arguments[0] === 'number' ? m.valueOf() : m.format('YYYY-MM-DD HH:mm:ss.SSS');
  return moment.tz(v, this.timezoneName);
};

/**
 * @param [fmt] 格式化字符串
 * @returns {string} 当前日历时间字符串
 */
TradeCalendar.prototype.currentTime = function (fmt) {
  return moment.tz(this.now(), this.timezoneName).format(fmt);
};

/**
 * 获取日历中某个日期最近的交易日期信息
 *
 * @param {string|number|Moment} [date] 日期
 * @param {number} [direction] 查找方向(小于0表示向前(历史)查找,否则表示向后(未来)查找)
 * @returns {TimeInfo} 日历中的交易时间
 */
TradeCalendar.prototype.timeInfo = async function (date, direction) {
  let config = this._config;
  let timePeriods = [];
  direction = direction < 0 ? -1 : 1;
  const _stamp = (time) => {
    return moment.tz(moment(time).format('YYYY-MM-DD HH:mm:ss.SSS'), this.timezoneName).valueOf();
  };
  const _format = (date) => {
    if (typeof date === 'number') {
      return moment(date.toString(), 'YYYYMMDD').format('YYYY-MM-DD');
    } else if (date && date.format) {
      return date.format('YYYY-MM-DD');
    }
    return date;
  };
  const _point2timestamp = (date, point) => {
    let m = moment(_format(date));
    m.set('hour', point.hour);
    m.set('minute', point.minute);
    m.set('second', point.second);
    m.set('millisecond', point.millisecond);
    return m.valueOf();
  };
  for (date = moment.tz(_format(date), this.timezoneName);; date.add(direction, 'day')) {
    let days = date.days();
    if (days > 0 && days < 6) { // 排除周末
      let sd = date.format('YYYY-MM-DD');
      let start = _point2timestamp(sd, config.start); // 设置交易开始时间点
      let end = _point2timestamp(sd, config.end); // 设置交易结束时间点
      // 查找这段时间内的节假日
      let holidays = await this.findHolidays(start, end);
      if (holidays && holidays.length > 0) { // 正常交易时间段出现节假日
        holidays.forEach(holiday => {
          if (start < holiday.start) { // 节假日在开盘之后，比如下午休市半天，或中午休市
            timePeriods.push({
              start: _stamp(start),
              end: _stamp(holiday.start)
            });
          }
          if (end > holiday.end) { // 节假日出现在收盘之前，比如上午休市半天，或中午休市
            timePeriods.push({
              start: _stamp(holiday.end),
              end: _stamp(end)
            });
          }
        });
        if (timePeriods.length === 0) { // 一天都休市，没有可交易的时间视为非交易日
          continue;
        }
      } else { // 没有休市，一天都是交易时间
        timePeriods.push({
          start: _stamp(start),
          end: _stamp(end)
        });
      }
      return {
        tradeDate: parseInt(date.format('YYYYMMDD'), 10),
        timePeriods: timePeriods,
        dayStart: date.startOf('day').valueOf(),
        dayEnd: date.endOf('day').valueOf()
      };
    }
  }
};

/**
 * 按照时间段查找节假日列表
 *
 * @param {number} start 查询开始时间戳(毫秒)
 * @param {number} end 查询结束时间戳(毫秒)
 * @returns {TimePeriod[]} 节假日区间列表
 */
TradeCalendar.prototype.findHolidays = async function (start, end) {
  let holidays = await this._holidayFinder(start, end);
  if (!holidays) return [];
  holidays.sort((a, b) => {
    return a.start - b.start;
  });
  let rs = [],
    pre;
  holidays.forEach((holiday) => {
    if (!pre) {
      pre = {
        start: holiday.start.getTime && holiday.start.getTime() || holiday.start,
        end: holiday.end.getTime && holiday.end.getTime() || holiday.end
      };
      rs.push(pre);
    } else {
      if (holiday.start > pre.end) {
        pre = {
          start: holiday.start.getTime && holiday.start.getTime() || holiday.start,
          end: holiday.end.getTime && holiday.end.getTime() || holiday.end
        };
        rs.push(pre);
      } else {
        pre.end = holiday.end.getTime && holiday.end.getTime() || holiday.end;
      }
    }
  });
  return rs;
};

/**
 * 根据日历中的时间计算实际的时间戳
 *
 * @param {number|Date|Moment} [time] 日历中的时间
 * @returns {number} 实际时间戳
 */
TradeCalendar.prototype.realStamp = function (time) {
  return time && time.valueOf && time.valueOf() || time || Date.now();
};

/**
 * 获取某个日期最近的交易日期信息
 *
 * @param {string|number|Moment} [date] 日期
 * @param {number} [direction] 查找方向(小于0表示向前(历史)查找,否则表示向后(未来)查找)
 * @returns {TimeInfo}
 */
TradeCalendar.prototype.realTimeInfo = async function (date, direction) {
  let timeInfo = await this.timeInfo(date || this.today(), direction);
  return {
    tradeDate: timeInfo.tradeDate,
    timePeriods: timeInfo.timePeriods.map(this.realTimePeriod.bind(this)),
    dayStart: this.realStamp(timeInfo.dayStart),
    dayEnd: this.realStamp(timeInfo.dayEnd)
  };
};

TradeCalendar.prototype.getTimeInfo = TradeCalendar.prototype.realTimeInfo;

/**
 *
 * @param {TimePeriod} period 实际的时间段
 * @returns {TimePeriod} 日历中的时间段
 */
TradeCalendar.prototype.timePeriod = function (period) {
  return {
    start: this.timestamp(period.start),
    end: this.timestamp(period.end)
  };
};

/**
 *
 * @param {TimePeriod} period 日历中的时间段
 * @returns {TimePeriod} 实际的时间段
 */
TradeCalendar.prototype.realTimePeriod = function (period) {
  return {
    start: this.realStamp(period.start),
    end: this.realStamp(period.end)
  };
};

TradeCalendar.prototype.point2timestamp = function (date, point) {
  if (typeof date === 'number') {
    date = moment(date.toString(), 'YYYYMMDD').format('YYYY-MM-DD');
  } else if (date.format) {
    date = date.format('YYYY-MM-DD');
  }
  let m = moment.tz(date, this.timezoneName);
  m.set('hour', point.hour);
  m.set('minute', point.minute);
  m.set('second', point.second);
  m.set('millisecond', point.millisecond);
  return m.valueOf();
};

/**
 * 盘后结束时间
 *
 * @param {number|Date|Moment} date 交易日期
 * @returns {number} 盘后结束时间
 */
TradeCalendar.prototype.afterMarketEnd = function (date) {
  return this.point2timestamp(date, this._config.after.end);
};

/**
 * 盘后结束时间
 *
 * @param {number|Date|Moment} date 交易日期
 * @returns {number} 实际的盘后结束时间
 */
TradeCalendar.prototype.realAfterMarketEnd = function (date) {
  return this.realStamp(this.afterMarketEnd(date));
};

/**
 * 实际盘前开始时间
 * @param {number|Date|Moment} date 交易日期
 * @returns {number} 实际的盘前开始时间
 */
TradeCalendar.prototype.realBeforeMarketStart = function (date) {
  return this.realStamp(this.point2timestamp(date, this._config.before.start));
};

/**
 * 虚拟盘前开始时间
 * @param {number|Date|Moment} date 交易日期
 * @returns {number} 虚拟盘前开始时间
 */
TradeCalendar.prototype.beforeMarketStart = function (date) {
  return this.timestamp(this.realBeforeMarketStart(date));
};

/**
 * 虚拟日期开始时间
 * @param {number|Date|Moment} date 日期
 * @returns {number} 虚拟日期开始时间
 */
TradeCalendar.prototype.startOfDay = function (date) {
  return this.point2timestamp(date, {
    hour: 0,
    minute: 0,
    second: 0,
    millisecond: 0
  });
};

/**
 * 虚拟日期结束时间
 * @param {number|Date|Moment} date 日期
 * @returns {number} 虚拟日期结束时间
 */
TradeCalendar.prototype.endOfDay = function (date) {
  return this.point2timestamp(date, {
    hour: 23,
    minute: 59,
    second: 59,
    millisecond: 999
  });
};

/**
 * 虚拟开盘时间
 * @param {number|Date|Moment} date 交易日期
 * @returns {number} 虚拟的开盘时间
 */
TradeCalendar.prototype.marketOpen = function (date) {
  return this.timestamp(this.realMarketOpen(date));
};

/**
 * 虚拟收盘时间
 * @param {number|Date|Moment} date 交易日期
 * @returns {number} 虚拟的收盘时间
 */
TradeCalendar.prototype.marketClose = function (date) {
  return this.timestamp(this.realMarketClose(date));
};

/**
 * 开盘时间
 * @param {number|Date|Moment} date 交易日期
 * @returns {number} 实际的开盘时间
 */
TradeCalendar.prototype.realMarketOpen = function (date) {
  return this.realStamp(this.point2timestamp(date, this._config.start));
};

/**
 * 收盘时间
 * @param {number|Date|Moment} date 交易日期
 * @returns {number} 实际的收盘时间
 */
TradeCalendar.prototype.realMarketClose = function (date) {
  return this.realStamp(this.point2timestamp(date, this._config.end));
};

/**
 * 获取当日日期
 *
 * @returns {Number}
 */
TradeCalendar.prototype.today = function () {
  return parseInt(moment.tz(this.timestamp(), this.timezoneName).format('YYYYMMDD'), 10);
};

/**
 * @returns {number} 当前日历时间戳
 */
TradeCalendar.prototype.currentStamp = function () {
  return this.timestamp();
};

/**
 * @returns {number} 当前日历时间戳
 */
TradeCalendar.prototype.sqlStamp = function () {
  return parseInt(this.timestamp() / 1000, 10);
};

/**
 * @returns {string} 当前日历时间字符串
 */
TradeCalendar.prototype.sqlDatetime = function () {
  return moment.utc(this.timestamp()).format('YYYY-MM-DD HH:mm:ss');
};


/**
 * 将(对象的)日期相关函数的传入日期和返回参数进行实际时间和日历时间的转换。
 * 函数的入参的`Date`转换成日历中的`Date`;
 * 返回值的`Date`转换成实际的`Date`;
 *
 * @example
 * obj = wrap(obj, 'functionName')
 * fn = wrap(fn)
 * @returns {*}
 */
TradeCalendar.prototype.wrap = function () {
  let obj = arguments.length > 1 ? arguments[0] : null;
  let fn = obj ? arguments[1] : arguments[0];
  if (obj) {
    return obj;
  } else {
    return fn;
  }
};

/**
 * 用构造函数及其参数创建对象
 *
 * @param {constructor} c 构造函数
 * @param {*} args 参数列表
 * @protected
 */
TradeCalendar.prototype._new = function (c, args) {
  return new(Function.prototype.bind.apply(c, args));
};

/**
 * @returns {Date} 日历中的Date时间
 */
TradeCalendar.prototype.newDate = function () {
  return this._new(Date, arguments);
};

/**
 * 开盘时间
 * @param date
 * @returns {number}
 */
TradeCalendar.prototype.realOpenTime = function (date) {
  return this.realStamp(this.point2timestamp(date, this._config.start));
};

/**
 * 格式化交易时间段
 *
 * @param {{start, end}} timePeriod
 * @returns {{start, end}}
 */
TradeCalendar.prototype.formatTimePeriod = function (timePeriod) {
  return {
    start: moment.tz(timePeriod.start, this.timezoneName).format(),
    end: moment.tz(timePeriod.end, this.timezoneName).format()
  };
};

/**
 * 格式化时间信息
 *
 * @param {TimeInfo} timeInfo
 *
 * @returns {string}
 */
TradeCalendar.prototype.formatTimeInfo = function (timeInfo) {
  return {
    tradeDate: timeInfo.tradeDate,
    timePeriods: timeInfo.timePeriods.map(this.formatTimePeriod.bind(this)),
    dayStart: moment.tz(timeInfo.dayStart, this.timezoneName).format(),
    dayEnd: moment.tz(timeInfo.dayEnd, this.timezoneName).format()
  };
};

TradeCalendar.prototype.strTimeInfo = function (timeInfo) {
  return JSON.stringify(this.formatTimeInfo(timeInfo));
};

TradeCalendar.prototype.realTimeoutAt = function (listener, time) {
  return setTimeout(() => {
    if (Date.now() >= time) {
      listener();
    } else {
      this.realTimeoutAt(listener, time);
    }
  }, time - Date.now());
};

TradeCalendar.prototype.setTimeout = function (code, delay, ...args) {
  return this._setTimeout(code, delay, ...args);
};

TradeCalendar.prototype.setTimeoutAt = function (code, timestamp, ...args) {
  return this.setTimeout(code, timestamp - this.now(), ...args);
};


module.exports = TradeCalendar;