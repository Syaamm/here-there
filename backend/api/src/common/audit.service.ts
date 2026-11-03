import { Injectable } from '@nestjs/common';
import { PrismaService } from './prisma.service';

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  log(actorId: string | null, action: string, objectType: string, objectId: string, metadata?: unknown) {
    return this.prisma.auditEvent.create({
      data: { actorId, action, objectType, objectId, metadata: metadata ? JSON.stringify(metadata) : null },
    });
  }
}
