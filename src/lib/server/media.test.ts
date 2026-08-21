import { expect, test } from 'bun:test';
import { extensionFor } from './media';

test('accepts MediaRecorder MIME types with codec parameters', () => {
	expect(extensionFor('audio', 'audio/webm;codecs=opus')).toBe('webm');
	expect(extensionFor('audio', 'audio/ogg; codecs=opus')).toBe('ogg');
});

test('does not accept an audio MIME type as an image', () => {
	expect(extensionFor('image', 'audio/webm;codecs=opus')).toBeNull();
});
