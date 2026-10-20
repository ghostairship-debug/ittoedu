/*!
 * Easing formulae and name resolution adapted from Phaser 4.2.0.
 * Copyright (c) 2026 Richard Davey, Phaser Studio Inc.
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy of
 * this software and associated documentation files (the "Software"), to deal in
 * the Software without restriction, including without limitation the rights to
 * use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
 * the Software, and to permit persons to whom the Software is furnished to do so,
 * subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

type Ease = (value: number) => number
type EaseFamily = readonly [Ease, Ease, Ease]

const linear: Ease = value => value
const bounceOut: Ease = value => {
  if (value < 1 / 2.75) return 7.5625 * value * value
  if (value < 2 / 2.75) return 7.5625 * (value -= 1.5 / 2.75) * value + 0.75
  if (value < 2.5 / 2.75) return 7.5625 * (value -= 2.25 / 2.75) * value + 0.9375
  return 7.5625 * (value -= 2.625 / 2.75) * value + 0.984375
}
const backOvershoot = 1.70158
const elasticPeriod = 0.1, elasticShift = elasticPeriod / 4
const families: Record<string, EaseFamily> = {
  Quad: [
    value => value * value,
    value => value * (2 - value),
    value => (value *= 2) < 1 ? 0.5 * value * value : -0.5 * (--value * (value - 2) - 1),
  ],
  Cubic: [
    value => value * value * value,
    value => --value * value * value + 1,
    value => (value *= 2) < 1 ? 0.5 * value * value * value : 0.5 * ((value -= 2) * value * value + 2),
  ],
  Quart: [
    value => value * value * value * value,
    value => 1 - (--value * value * value * value),
    value => (value *= 2) < 1 ? 0.5 * value * value * value * value : -0.5 * ((value -= 2) * value * value * value - 2),
  ],
  Quint: [
    value => value * value * value * value * value,
    value => --value * value * value * value * value + 1,
    value => (value *= 2) < 1 ? 0.5 * value * value * value * value * value : 0.5 * ((value -= 2) * value * value * value * value + 2),
  ],
  Sine: [
    value => value === 0 || value === 1 ? value : 1 - Math.cos(value * Math.PI / 2),
    value => value === 0 || value === 1 ? value : Math.sin(value * Math.PI / 2),
    value => value === 0 || value === 1 ? value : 0.5 * (1 - Math.cos(Math.PI * value)),
  ],
  Expo: [
    value => Math.pow(2, 10 * (value - 1)) - 0.001,
    value => 1 - Math.pow(2, -10 * value),
    value => (value *= 2) < 1 ? 0.5 * Math.pow(2, 10 * (value - 1)) : 0.5 * (2 - Math.pow(2, -10 * (value - 1))),
  ],
  Circ: [
    value => 1 - Math.sqrt(1 - value * value),
    value => Math.sqrt(1 - (--value * value)),
    value => (value *= 2) < 1 ? -0.5 * (Math.sqrt(1 - value * value) - 1) : 0.5 * (Math.sqrt(1 - (value -= 2) * value) + 1),
  ],
  Elastic: [
    value => value === 0 || value === 1 ? value
      : -(Math.pow(2, 10 * (value -= 1)) * Math.sin((value - elasticShift) * (2 * Math.PI) / elasticPeriod)),
    value => value === 0 || value === 1 ? value
      : Math.pow(2, -10 * value) * Math.sin((value - elasticShift) * (2 * Math.PI) / elasticPeriod) + 1,
    value => {
      if (value === 0 || value === 1) return value
      return (value *= 2) < 1
        ? -0.5 * (Math.pow(2, 10 * (value -= 1)) * Math.sin((value - elasticShift) * (2 * Math.PI) / elasticPeriod))
        : Math.pow(2, -10 * (value -= 1)) * Math.sin((value - elasticShift) * (2 * Math.PI) / elasticPeriod) * 0.5 + 1
    },
  ],
  Back: [
    value => value * value * ((backOvershoot + 1) * value - backOvershoot),
    value => --value * value * ((backOvershoot + 1) * value + backOvershoot) + 1,
    value => {
      const overshoot = backOvershoot * 1.525
      return (value *= 2) < 1 ? 0.5 * (value * value * ((overshoot + 1) * value - overshoot))
        : 0.5 * ((value -= 2) * value * ((overshoot + 1) * value + overshoot) + 2)
    },
  ],
  Bounce: [
    value => 1 - bounceOut(1 - value), bounceOut,
    value => value < 0.5 ? (1 - bounceOut(1 - value * 2)) * 0.5 : bounceOut(value * 2 - 1) * 0.5 + 0.5,
  ],
}
const easeMap: Record<string, Ease> = {
  Power0: linear, Power1: families.Quad[1], Power2: families.Cubic[1], Power3: families.Quart[1], Power4: families.Quint[1],
  Linear: linear,
  Stepped: value => value <= 0 ? 0 : value >= 1 ? 1 : ((value | 0) + 1),
}
for (const [name, [easeIn, easeOut, easeInOut]] of Object.entries(families)) {
  easeMap[name] = easeOut
  easeMap[`${name}.easeIn`] = easeIn
  easeMap[`${name}.easeOut`] = easeOut
  easeMap[`${name}.easeInOut`] = easeInOut
}

/** The string-only GetEaseFunction behavior used by presentation transitions, without the game engine. */
export function resolveComponentEase(name: string): Ease {
  const owns = (key: string) => Object.prototype.hasOwnProperty.call(easeMap, key)
  if (owns(name)) return easeMap[name]
  const dot = name.indexOf('.')
  let direction = ''
  if (dot) {
    direction = name.substring(dot + 1)
    const lower = direction.toLowerCase()
    if (lower === 'in') direction = 'easeIn'
    else if (lower === 'out') direction = 'easeOut'
    else if (lower === 'inout') direction = 'easeInOut'
  }
  const candidate = name.substring(0, dot + 1) + direction
  const normalized = candidate && candidate[0].toUpperCase() + candidate.slice(1)
  return owns(normalized) ? easeMap[normalized] : linear
}
