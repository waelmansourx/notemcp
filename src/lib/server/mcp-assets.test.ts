import { describe, expect, test } from 'bun:test';
import { clampAssetSize, isForbiddenAssetAddress } from './mcp-assets';

describe('MCP asset size', () => {
	test('uses the bounded visual retrieval range', () => {
		expect(clampAssetSize(undefined)).toBe(640);
		expect(clampAssetSize(100)).toBe(512);
		expect(clampAssetSize(700.4)).toBe(700);
		expect(clampAssetSize(4000)).toBe(768);
	});
});

describe('MCP asset SSRF address checks', () => {
	test('blocks private, loopback, link-local and reserved IPv4', () => {
		for (const address of [
			'10.0.0.1',
			'127.0.0.1',
			'169.254.169.254',
			'172.16.4.2',
			'192.168.1.4',
			'100.64.0.1',
			'224.0.0.1'
		]) {
			expect(isForbiddenAssetAddress(address)).toBe(true);
		}
		expect(isForbiddenAssetAddress('8.8.8.8')).toBe(false);
	});

	test('blocks private IPv6 and IPv4-mapped loopback', () => {
		for (const address of ['::', '::1', 'fc00::1', 'fe80::1', '2001:db8::1', '::ffff:127.0.0.1']) {
			expect(isForbiddenAssetAddress(address)).toBe(true);
		}
		expect(isForbiddenAssetAddress('2606:4700:4700::1111')).toBe(false);
	});
});
