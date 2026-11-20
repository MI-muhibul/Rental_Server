import { Request, Response } from 'express';

export const getHealth = (req: Request, res: Response) => {
  res.status(200).json({
    status: 'ok',
    message: 'Equipment Rental API is healthy',
    timestamp: new Date().toISOString(),
  });
};
