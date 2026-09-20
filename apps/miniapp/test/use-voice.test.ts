import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

const { voiceType } = await import('../dist-test/use-voice.js');

describe('тип записи для расшифровки', () => {
  it('параметры кодека отбрасываются: ручка знает только сам тип', () => {
    assert.equal(voiceType('audio/webm;codecs=opus'), 'audio/webm');
    assert.equal(voiceType('audio/ogg; codecs=opus'), 'audio/ogg');
    assert.equal(voiceType('audio/mp4'), 'audio/mp4');
  });

  it('системная запись приходит под своими именами', () => {
    assert.equal(voiceType('audio/x-m4a'), 'audio/mp4');
    assert.equal(voiceType('audio/m4a'), 'audio/mp4');
    assert.equal(voiceType('audio/x-wav'), 'audio/wav');
    assert.equal(voiceType('AUDIO/WAVE'), 'audio/wav');
  });

  it('пустой или чужой тип считается записью клиента', () => {
    assert.equal(voiceType(''), 'audio/ogg');
    assert.equal(voiceType('application/octet-stream'), 'audio/ogg');
  });
});
