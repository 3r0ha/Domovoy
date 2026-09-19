import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { commonNeedsFor, commonNeedsTitle } from '../dist/index.js';

describe('общедомовые нужды', () => {
  it('делят разницу дома и квартир по площади', () => {
    assert.equal(commonNeedsFor({ house: 100, apartments: 80, area: 50, totalArea: 200 }), 5);
  });

  it('без разницы начислять нечего', () => {
    assert.equal(commonNeedsFor({ house: 80, apartments: 80, area: 50, totalArea: 200 }), 0);
  });

  it('квартиры показали больше дома, значит, сдали не все', () => {
    assert.equal(commonNeedsFor({ house: 60, apartments: 80, area: 50, totalArea: 200 }), 0);
  });

  it('без площади доли нет', () => {
    assert.equal(commonNeedsFor({ house: 100, apartments: 0, area: 0, totalArea: 200 }), 0);
    assert.equal(commonNeedsFor({ house: 100, apartments: 0, area: 50, totalArea: 0 }), 0);
  });

  it('вся площадь дома у одной квартиры, весь общедомовой расход её', () => {
    assert.equal(commonNeedsFor({ house: 100, apartments: 40, area: 200, totalArea: 200 }), 60);
  });

  it('доли помещений в сумме дают весь распределяемый объём', () => {
    const shares = [1, 1, 1].map((area) => commonNeedsFor({ house: 101, apartments: 100, area, totalArea: 3 }));
    const total = shares.reduce((sum, share) => sum + share, 0);

    assert.ok(Math.abs(total - 1) < 1e-9, `в сумме вышло ${total}, а распределяли 1`);
  });

  it('строка квитанции называет ресурс, а не одно сокращение', () => {
    assert.equal(commonNeedsTitle('cold_water'), 'Холодная вода на общие нужды дома');
  });
});
