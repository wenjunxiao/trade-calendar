'use strict';

const util = require('util');
const assert = require('assert');
const _ = require('lodash');
const moment = require('moment');
const debug = require('debug')('VirtualCalendar');
/**
 * @type {Function|TradeCalendar}
 */
const TradeCalendar = require('./trade');

const logStamp = debug.enabled ? (stamp) => moment(stamp).format() : () => {
};
const logArgsStamp = debug.enabled ? (args) => {
  return _.reduce(args, (r, v, k) => {
    r[k] = moment(v).format();
    return r;
  }, {});
} : () => {
};

/**
 * 虚拟时间策略
 * 虚拟时间计算公式: (真实时间戳 - 真实参考时间戳) / 换算比率 + 虚拟参考时间戳
 * 虚拟时间思路:
 * 1.选择一个时间戳作为真实参考时间戳(UTC标准参考时间为0,可以选定任何时间作为标准时间,比如2017-01-01 00:00:00的为1483200000000)
 * 2.选择一个时间戳作为虚拟参考时间戳(可以选定任何时间作为虚拟标准时间,比如2017-01-01 00:00:00的为1483200000000)
 * 3.一个实际的时间减去真实参考时间戳表示真实时间(向前/向后)走了多少毫秒(比如2017-01-01 12:00:00比上面选择的标准时间的走了43200000)
 * 4.换算比率的概念就是虚拟时间走一毫秒,真实时间走多少毫秒(比如虚拟一天是12小时,即真实的一天是虚拟的两天,即虚拟时间走1秒,真实只走0.5)
 * 5.真实时间差除换算比率得到的是真实时间走过的时间反应在虚拟时间应该走了多少时间(比如43200000 / 0.5 = 86400000)
 * 6.上面的例子中真实时间从2017-01-01 00:00:00走到2017-01-01 12:00:00的时候,虚拟时间走到了2017-01-02 00:00:00,也就是说虚拟时间
 *   比真实时间快了一倍,这样就可以在一天之内去跑两天(设置虚拟一天的毫秒数可以跑更多天)的业务,缩短测试需要等待的时间
 * 参数设置技巧:
 * 1.设置换算比率,只需要设置想在多长时间内跑完一天流程,比如一个小时之内跑完一天的流程,只需要设置`config.virtual.oneDay`的值为60*1000
 * 2.策略设置参考策略描述
 * @see VirtualCalendar.timestamp
 * @enum {string}
 */
const Strategy = {
  /**
   * 采用系统时间,忽略其他配置
   */
  SYSTEM: 'SYSTEM',
  /**
   * 标准虚拟时间点与其对应的实际时间点一致,其他虚拟时间推算。
   * 这样做的目的是对齐真实与虚拟时间的某个点。换算比率为1的时候,虚拟时间和真实完全一致,因为参考时间一样,时间差一样。
   * 换算比率不为1的时候,只在参考点相同。
   * 通常用于设置系统从某个时间开始上线运行,就算系统某段时间没有运行,虚拟时间也会一直在走(`config.virtual.persistent`设置为false)
   */
  STANDARD: 'STANDARD',
  /**
   * 标准虚拟时间点与启动时间点`calendar.startTime`对应,其他时间推算。
   * 启动的时候恰好是虚拟参考时间点,这样可以保证每次启动应用都是从指定的虚拟时间开始走。
   * 例1:每次启动的时候是当天的开盘时间,这样就不用等待时间走到开盘时间才能进行交易。
   * 例2:每次启动的时候按照上次应用停止的虚拟时间继续走,在应用停止时保存当时的虚拟时间(`config.virtual.persistent`设置为true),
   *   下次启动的时候把上次的虚拟时间设置为虚拟参考时间点,这样应用的虚拟时间就会接着上次的时间继续走了。不用担心由于停止应用之后虚拟时间
   *   继续走而错过了关键的业务操作时间点。
   */
  START: 'START',
  /**
   * 标准虚拟时间点与自定义时间点`config.virtual.custom`对应,其他时间推算。
   * 更加灵活的定义虚拟时间参考点与真实时间参考点,可以达到`STANDARD`和`START`的效果。
   * 将`config.virtual.custom`和`config.virtual.standard`设置为相同的即为`STANDARD`。
   * 将`config.virtual.custom`设置为启动时间即为`START`。
   * 除此之外,还可以更为复杂的时间控制,将虚拟时间设置成任何时点,避免了`STANDARD`和`START`实际参考时间的无法控制的问题。
   * 比如,交易系统从某天开始模拟香港回归的时间1997-07-01 00:00:00来运行系统的设置
   * ```
   * virtual: {
   *   enabled: true,
   *   persistent: false,
   *   strategy: VirtualCalendar.Strategy.CUSTOM,
   *   standard: '1997-07-01 00:00:00',
   *   custom: '2017-01-01 00:00:00'
   * }
   * ```
   */
  CUSTOM: 'CUSTOM'
};

/**
 * 虚拟日历
 *
 * @param {CalendarConfig} config 时间配置
 * @param {{}} config.virtual 虚拟日历配置
 * @param {Strategy} config.virtual.strategy 虚拟时间配置
 * @param {string|number|Date|Moment} config.virtual.standard 标准虚拟时间
 * @param {string|number|Date|Moment} [config.virtual.custom] 标准虚拟时间
 * @param {number} config.virtual.oneDay 一天包含的毫秒数,默认24小时,与真实时间一致
 * @param {CalendarConfig} [config.virtual.config] 覆盖`config`的选项
 * @param {GeneratorFunction} [holidayFinder] 节假日获取
 * @constructor
 * @extends TradeCalendar
 */
function VirtualCalendar(config, holidayFinder) {
  if (!(this instanceof VirtualCalendar)) return new VirtualCalendar(config, holidayFinder);
  assert(config.virtual, '配置缺少[virtual]');
  TradeCalendar.call(this, config, holidayFinder);
  this.reload({});
}

util.inherits(VirtualCalendar, TradeCalendar);

/**
 * 重新加载配置
 * @param {CalendarConfig} config 时间配置
 * @param {GeneratorFunction} [holidayFinder] 查找节假日函数
 */
VirtualCalendar.prototype.reload = function (config, holidayFinder) {
  _.merge(this._config, _.cloneDeep(config));
  if (holidayFinder) {
    this._holidayFinder = holidayFinder;
  }
  let vc = this._config.virtual;
  _.merge(this._config, _.cloneDeep(vc.config));
  this._oneDay = vc.oneDay;
  this._timeRatio = this._oneDay / (24 * 60 * 60 * 1000);
  let strategy = this.strategy = vc.strategy || Strategy.STANDARD;
  this._virtualBase = moment(vc.standard).valueOf();
  if (strategy === Strategy.SYSTEM) {
    this._timeRatio = 1;
    this._virtualBase = 0;
    this._realBase = 0;
  } else if (strategy === Strategy.STANDARD) {
    this._realBase = this._virtualBase;
  } else if (strategy === Strategy.START) {
    this._realBase = this.startTime;
  } else if (strategy === Strategy.CUSTOM) {
    assert(vc.custom, '策略[CUSTOM]必须配置`custom`的值');
    this._realBase = moment(vc.custom).valueOf();
  } else {
    throw new Error('INVALID_STRATEGY');
  }
};

/**
 * 根据实际时间计算虚拟时间
 *
 * @param {number|Date|Moment} [time] 实际时间
 * @returns {number} 虚拟时间戳
 */
VirtualCalendar.prototype.timestamp = function (time) {
  time = time || Date.now();
  return (time - this._realBase) / this._timeRatio + this._virtualBase;
};

/**
 * 根据虚拟时间计算实际时间
 * @param {number|Date|Moment} time 虚拟时间
 * @returns {number} 实际时间
 */
VirtualCalendar.prototype.realStamp = function (time) {
  time = time || Date.now();
  return (time - this._virtualBase) * this._timeRatio + this._realBase;
};

/**
 * 将(对象的)日期相关函数的传入日期和返回参数进行实际时间和虚拟时间的转换
 *
 * @returns {*}
 */
VirtualCalendar.prototype.wrap = function () {
  let self = this;

  function _wrapArgs() {
    let args = [].slice.call(arguments).map((arg) => {
      if (arg instanceof Date) {
        arg.setTime(self.timestamp(arg.getTime()));
      }
      return arg;
    });
    if (args.length === 0) {
      args.push(new Date(self.currentStamp()));
    }
    return args;
  }

  function _wrap(fn) {
    assert(typeof fn === 'function', '必须是function');
    if (fn.__originalDateFunction__) return fn;
    let _fn;
    if (fn.constructor && fn.constructor.name === 'GeneratorFunction') {
      _fn = function*() {
        let date = yield fn.apply(this, arguments);
        let original = date.getTime();
        let changed = self.realStamp(original);
        debug('change timestamp: %j %s %s', logArgsStamp(arguments), logStamp(original), logStamp(changed));
        date.setTime(changed);
        return date;
      };
    } else {
      _fn = function () {
        let _arguments = arguments;
        let args = _wrapArgs.call(_arguments);
        let date = fn.apply(this, args);
        if (typeof date.then === 'function') {
          return new Promise((resolve, reject) => {
            let _resolve = (data) => {
              let original = data.getTime();
              let changed = self.realStamp(original);
              debug('change timestamp: %j %s %s', logArgsStamp(_arguments), logStamp(original), logStamp(changed));
              data.setTime(changed);
              return resolve(data);
            };
            return date.then(_resolve, reject);
          });
        }
        let original = date.getTime();
        let changed = self.realStamp(original);
        debug('change timestamp: %j %s %s', logArgsStamp(_arguments), logStamp(original), logStamp(changed));
        date.setTime(changed);
        return date;
      };
    }
    _fn.__originalDateFunction__ = fn;
    return _fn;
  }

  let obj = arguments.length > 1 ? arguments[0] : null;
  let fn = obj ? arguments[1] : arguments[0];
  if (obj) {
    let name = typeof fn === 'function' ? fn.name : fn;
    fn = typeof fn === 'function' ? fn : obj[name];
    obj[name] = _wrap(fn);
  } else {
    return _wrap(fn);
  }
};

VirtualCalendar.prototype.moment = function () {
  let m = this._apply(moment, arguments);
  return moment(this.timestamp(m.valueOf()));
};

VirtualCalendar.prototype.newDate = function () {
  let date = this._new(Date, arguments);
  date.setTime(this.timestamp(date.getTime()));
  return date;
};

VirtualCalendar.Strategy = Strategy;
module.exports = VirtualCalendar;

