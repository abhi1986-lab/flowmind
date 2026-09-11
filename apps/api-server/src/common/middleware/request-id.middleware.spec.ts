import { RequestIdMiddleware } from './request-id.middleware';

describe('RequestIdMiddleware', () => {
  it('sets x-request-id when missing and calls next', () => {
    const req: any = { headers: {} };
    const res: any = { setHeader: jest.fn(), locals: {} };
    const next = jest.fn();
    RequestIdMiddleware(req, res, next);
    expect(req.requestId).toBeTruthy();
    expect(res.locals.requestId).toBe(req.requestId);
    expect(res.setHeader).toHaveBeenCalledWith('x-request-id', req.requestId);
    expect(next).toHaveBeenCalled();
  });

  it('preserves existing x-request-id', () => {
    const req: any = { headers: { 'x-request-id': 'abc' } };
    const res: any = { setHeader: jest.fn(), locals: {} };
    const next = jest.fn();
    RequestIdMiddleware(req, res, next);
    expect(req.requestId).toBe('abc');
    expect(res.setHeader).toHaveBeenCalledWith('x-request-id', 'abc');
  });
});
