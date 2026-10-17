// MS50-TC04/07/08/09 / QAD-TC46: test the actual supervisor event boundary.
import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import launcher from '../scripts/rag-start.cjs';

function fixture(mode = 'api') {
  const host = Object.assign(new EventEmitter(), { exitCode: undefined as number | undefined });
  const child = Object.assign(new EventEmitter(), {
    stdin: Object.assign(new EventEmitter(), { end: vi.fn() }), killed: false, kill: vi.fn(),
  });
  const report = { error: vi.fn() };
  launcher.superviseChild(child, mode, host, report, 50);
  return { host, child, report };
}

describe('MS50 local launcher child lifecycle', () => {
  it('reports a safe spawn failure without rendering arbitrary exception text', () => {
    const { host, child, report } = fixture();
    child.emit('error', new Error('synthetic-secret'));
    expect(host.exitCode).toBe(1);
    expect(report.error).toHaveBeenCalledWith(expect.stringContaining('SPAWN_FAILED'));
    expect(JSON.stringify(report.error.mock.calls)).not.toContain('synthetic-secret');
    expect(host.listenerCount('SIGINT')).toBe(0);
  });
  it.each([1, 0])('propagates unexpected API exit %i as failure', code => {
    const { host, child, report } = fixture();
    child.emit('exit', code, null);
    expect(host.exitCode).toBe(1);
    expect(report.error).toHaveBeenCalledWith(expect.stringContaining('CHILD_EXIT'));
  });
  it.each(['SIGINT', 'SIGTERM'])('uses the private shutdown pipe for %s and exits cleanly', signal => {
    const { host, child, report } = fixture();
    host.emit(signal);
    host.emit(signal);
    expect(child.stdin.end).toHaveBeenCalledExactlyOnceWith('shutdown\n');
    expect(child.kill).not.toHaveBeenCalled();
    child.emit('exit', 0, null);
    expect(host.exitCode).toBe(0);
    expect(report.error).not.toHaveBeenCalled();
    expect(host.listenerCount(signal)).toBe(0);
  });
  it('retains worker signal forwarding and normal exit semantics', () => {
    const { host, child } = fixture('worker');
    host.emit('SIGTERM');
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    child.emit('exit', null, 'SIGTERM');
    expect(host.exitCode).toBe(0);
  });
  it('bounds shutdown and targets only the owned child', async () => {
    const { host, child, report } = fixture();
    host.emit('SIGTERM');
    await new Promise(resolve => setTimeout(resolve, 70));
    expect(child.kill).toHaveBeenCalledOnce();
    expect(report.error).toHaveBeenCalledWith(expect.stringContaining('SHUTDOWN_TIMEOUT'));
    child.emit('exit', 1, null);
    expect(host.exitCode).toBe(1);
  });
});
