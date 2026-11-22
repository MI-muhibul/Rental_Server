import { Request, Response, NextFunction } from 'express';

export const errorHandler = (
  err: Error,
  req: Request,
  res: Response,
  next: NextFunction
) => {
  if (err.message && err.message.includes('CORS error')) {
    return res.status(403).json({
      success: false,
      error: err.message,
    });
  }

  console.error(err.stack);
  res.status(500).json({
    error: err.message || 'Internal Server Error',
  });
};
