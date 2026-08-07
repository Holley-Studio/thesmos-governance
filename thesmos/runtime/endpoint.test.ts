// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
import { describe, it, expect } from 'vitest';
import { classifyHost, isLocalEndpoint, parseEndpoint, InvalidEndpointError } from './endpoint.js';

describe('classifyHost', () => {
  it('treats loopback names and addresses as local', () => {
    expect(classifyHost('localhost')).toBe('local');
    expect(classifyHost('LOCALHOST')).toBe('local');
    expect(classifyHost('127.0.0.1')).toBe('local');
    expect(classifyHost('::1')).toBe('local');
  });

  it('treats the whole 127.0.0.0/8 block as loopback', () => {
    // Matching only 127.0.0.1 would demand approval for an equally-local address.
    expect(classifyHost('127.0.0.2')).toBe('local');
    expect(classifyHost('127.255.255.254')).toBe('local');
  });

  it('classifies RFC1918 ranges as lan, not local', () => {
    expect(classifyHost('192.168.1.50')).toBe('lan');
    expect(classifyHost('10.0.0.4')).toBe('lan');
    expect(classifyHost('172.16.9.9')).toBe('lan');
    expect(classifyHost('172.31.255.1')).toBe('lan');
  });

  it('does not mistake 172.32/172.15 for private space', () => {
    expect(classifyHost('172.15.0.1')).toBe('remote');
    expect(classifyHost('172.32.0.1')).toBe('remote');
  });

  it('classifies public hosts as remote', () => {
    expect(classifyHost('example.com')).toBe('remote');
    expect(classifyHost('8.8.8.8')).toBe('remote');
  });

  it('refuses to let a hostname borrow loopback trust by containing it', () => {
    // The attack this exists to stop: a remote host that merely *looks* local.
    expect(classifyHost('127.0.0.1.attacker.com')).toBe('remote');
    expect(classifyHost('localhost.evil.example')).toBe('remote');
    expect(classifyHost('notlocalhost')).toBe('remote');
  });
});

describe('parseEndpoint', () => {
  it('normalizes an origin and drops the path', () => {
    const parsed = parseEndpoint('http://127.0.0.1:11434/api/');
    expect(parsed.origin).toBe('http://127.0.0.1:11434');
    expect(parsed.port).toBe(11434);
    expect(parsed.locality).toBe('local');
  });

  it('infers default ports by scheme', () => {
    expect(parseEndpoint('https://example.com').port).toBe(443);
    expect(parseEndpoint('http://example.com').port).toBe(80);
  });

  it('rejects non-http protocols', () => {
    expect(() => parseEndpoint('file:///etc/passwd')).toThrow(InvalidEndpointError);
    expect(() => parseEndpoint('ftp://example.com')).toThrow(InvalidEndpointError);
    expect(() => parseEndpoint('javascript:alert(1)')).toThrow(InvalidEndpointError);
  });

  it('rejects malformed and empty input', () => {
    expect(() => parseEndpoint('')).toThrow(InvalidEndpointError);
    expect(() => parseEndpoint('   ')).toThrow(InvalidEndpointError);
    expect(() => parseEndpoint('not a url')).toThrow(InvalidEndpointError);
    expect(() => parseEndpoint('127.0.0.1:11434')).toThrow(InvalidEndpointError);
  });

  it('rejects embedded credentials so no secret can reach a log', () => {
    expect(() => parseEndpoint('http://user:pass@example.com')).toThrow(/credentials/);
  });

  it('classifies a query string that mentions loopback as still remote', () => {
    expect(parseEndpoint('http://evil.example.com/?host=127.0.0.1').locality).toBe('remote');
  });
});

describe('isLocalEndpoint', () => {
  it('is true only for loopback', () => {
    expect(isLocalEndpoint('http://127.0.0.1:11434')).toBe(true);
    expect(isLocalEndpoint('http://localhost:11434')).toBe(true);
    expect(isLocalEndpoint('http://192.168.1.5:11434')).toBe(false);
    expect(isLocalEndpoint('https://ollama.example.com')).toBe(false);
  });

  it('returns false rather than throwing on malformed input', () => {
    expect(isLocalEndpoint('nonsense')).toBe(false);
  });
});
