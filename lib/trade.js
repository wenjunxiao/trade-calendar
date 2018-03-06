'use strict';

const _ = require('lodash');
const moment = require('moment');

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

/**
 * 格式化交易时间段
 *
 * @param {{start, end}} timePeriod
 * @returns {{start, end}}
 */
function formatTimePeriod(timePeriod) {
  return {
    start: moment(timePeriod.start).format(),
    end: moment(timePeriod.end).format()
  };
}

/**
 * 格式化时间信息
 *
 * @param {TimeInfo} timeInfo
 *
 * @returns {string}
 */
function formatTimeInfo(timeInfo) {
  return JSON.stringify({
    tradeDate: timeInfo.tradeDate,
    timePeriods: timeInfo.timePeriods.map(formatTimePeriod),
    dayStart: moment(timeInfo.dayStart).format(),
    dayEnd: moment(timeInfo.dayEnd).format()
  });
}

/**
 * 转换成moment对象
 *
 * @param {string|number|Moment} date 日期,比如`'2016-01-01'` or `20160101` or `moment()`
 * @returns {moment|Moment}
 */
function momentFactory(date) {
  if (typeof date === 'number' && date.toString().length === 8) {
    date = date.toString();
  }
  return moment(date);
}

/**
 * 时间点转换成时间戳
 *
 * @param {string|number|moment} date 日期
 * @param {TimePoint} point 时间点
 * @returns {number}
 */
function point2timestamp(date, point) {
  let m = momentFactory(date);
  m.set('hour', point.hour);
  m.set('minute', point.minute);
  m.set('second', point.second);
  m.set('millisecond', point.millisecond);
  return m.valueOf();
}
/**
 * 空节假日
 * @returns {Array}
 */
const emptyHolidayFinder = function*() {
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
  this._config = _.cloneDeep(config);
  this._holidayFinder = holidayFinder || emptyHolidayFinder;
  /**
   * 启动时间
   * @member {number}
   */
  this.startTime = Date.now();
}

/**
 * 重新加载配置
 * @param {CalendarConfig} config 时间配置
 * @param {GeneratorFunction} [holidayFinder] 查找节假日函数
 */
TradeCalendar.prototype.reload = function (config, holidayFinder) {
  _.merge(this._config, _.cloneDeep(config));
  if (holidayFinder) {
    this._holidayFinder = holidayFinder;
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
 * 获取某个日期最近的交易日期信息
 *
 * @param {string|number|Moment} [date] 日期
 * @param {number} [direction] 查找方向(小于0表示向前(历史)查找,否则表示向后(未来)查找)
 * @returns {TimeInfo}
 */
TradeCalendar.prototype.getTimeInfo = async function (date, direction) {
  let timeInfo = await this.timeInfo(date || this.today(), direction);
  return {
    tradeDate: timeInfo.tradeDate,
    timePeriods: timeInfo.timePeriods.map(this.realTimePeriod.bind(this)),
    dayStart: this.realStamp(timeInfo.dayStart),
    dayEnd: this.realStamp(timeInfo.dayEnd)
  };
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
  for (date = momentFactory(date); ; date.add(direction, 'day')) {
    let days = date.days();
    if (days > 0 && days < 6) { // 排除周末
      let start = point2timestamp(date, config.start); // 设置交易开始时间点
      let end = point2timestamp(date, config.end); // 设置交易结束时间点
      // 查找这段时间内的节假日
      let holidays = await this.findHolidays(start, end);
      if (holidays && holidays.length > 0) { // 正常交易时间段出现节假日
        holidays.forEach(holiday => {
          if (start < holiday.start) { // 节假日在开盘之后，比如下午休市半天，或中午休市
            timePeriods.push({
              start: start,
              end: holiday.start
            });
          }
          if (end > holiday.end) { // 节假日出现在收盘之前，比如上午休市半天，或中午休市
            timePeriods.push({
              start: holiday.end,
              end: end
            });
          }
        });
        if (timePeriods.length === 0) { // 一天都休市，没有可交易的时间视为非交易日
          continue;
        }
      } else { // 没有休市，一天都是交易时间
        timePeriods.push({
          start: start,
          end: end
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
 * 根据实际时间计算日历中的时间戳
 *
 * @param {number|Date|Moment} [time] 实际时间
 * @returns {number} 日历时间戳
 */
TradeCalendar.prototype.timestamp = function (time) {
  return time && time.valueOf && time.valueOf() || time || Date.now();
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
 * 盘后结束时间
 *
 * @param {number|Date|Moment} date 交易日期
 * @returns {number} 实际的盘后结束时间
 */
TradeCalendar.prototype.realAfterMarketEnd = function (date) {
  return this.realStamp(point2timestamp(date, this._config.after.end));
};

/**
 * 实际盘前开始时间
 * @param {number|Date|Moment} date 交易日期
 * @returns {number} 实际的盘前开始时间
 */
TradeCalendar.prototype.realBeforeMarketStart = function (date) {
  return this.realStamp(point2timestamp(date, this._config.before.start));
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
  return point2timestamp(date, {
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
  return point2timestamp(date, {
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
  return this.realStamp(point2timestamp(date, this._config.start));
};

/**
 * 收盘时间
 * @param {number|Date|Moment} date 交易日期
 * @returns {number} 实际的收盘时间
 */
TradeCalendar.prototype.realMarketClose = function (date) {
  return this.realStamp(point2timestamp(date, this._config.end));
};

/**
 * 获取当日日期
 *
 * @returns {Number}
 */
TradeCalendar.prototype.today = function () {
  return parseInt(moment(this.timestamp()).format('YYYYMMDD'), 10);
};

/**
 * @returns {number} 当前日历时间戳
 */
TradeCalendar.prototype.currentStamp = function () {
  return this.timestamp();
};

/**
 * @param [fmt] 格式化字符串
 * @returns {string} 当前日历时间字符串
 */
TradeCalendar.prototype.currentTime = function (fmt) {
  return moment(this.timestamp()).format(fmt);
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
 * setTimeout
 * @param fn
 * @param delay
 * @returns {number|Object}
 */
TradeCalendar.prototype.setTimeout = function (fn, delay) {
  return setTimeout(fn, delay);
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
 * 调用函数并将函数自身作为this
 *
 * @param {function} f 调用的函数
 * @param {*} args 参数
 * @returns {*} 函数的执行结果
 * @protected
 */
TradeCalendar.prototype._apply = function (f, args) {
  return f.apply(f, args);
};

/**
 * 用构造函数及其参数创建对象
 *
 * @param {constructor} c 构造函数
 * @param {*} args 参数列表
 * @protected
 */
TradeCalendar.prototype._new = function (c, args) {
  return new (Function.prototype.bind.apply(c, args));
};

/**
 * @returns {moment|Moment} 日历中的moment时间
 */
TradeCalendar.prototype.moment = function () {
  return this._apply(moment, arguments);
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
  return this.realStamp(point2timestamp(date, this._config.start));
};

TradeCalendar.formatTimeInfo = formatTimeInfo;
TradeCalendar.prototype.formatTimeInfo = formatTimeInfo;

module.exports = TradeCalendar;

