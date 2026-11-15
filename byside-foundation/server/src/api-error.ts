import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Response } from 'express';

/** Keep the public error envelope stable without exposing internal errors or credentials. */
@Catch()
export class ApiErrorFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();
    if (response.headersSent) { response.end(); return; }
    let status = HttpStatus.INTERNAL_SERVER_ERROR, message: string | string[] = '服务内部错误', error = 'Internal Server Error';
    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const details = exception.getResponse();
      message = typeof details === 'string' ? details : (details as any).message || exception.message;
      error = typeof details === 'object' && (details as any).error ? (details as any).error : exception.name.replace(/Exception$/, '');
    } else if (exception instanceof Prisma.PrismaClientKnownRequestError && exception.code === 'P2025') {
      status = HttpStatus.NOT_FOUND; message = '资源不存在'; error = 'Not Found';
    } else if (exception instanceof Prisma.PrismaClientKnownRequestError && exception.code === 'P2002') {
      status = HttpStatus.CONFLICT; message = '资源已存在'; error = 'Conflict';
    }
    response.status(status).json({ statusCode: status, message, error });
  }
}
