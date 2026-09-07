import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Contract } from '../../entities/contract.entity';
import { Ticket } from '../../entities/ticket.entity';
import { Sla } from '../../entities/sla.entity';
import { SystemSettings } from '../../entities/system-settings.entity';
import { TicketPriority, SlaStatus } from '../../common/enums';
import {
  addBusinessMinutes,
  BusinessHours,
  classifySla,
} from '../../common/utils/business-hours.util';

// Allow SLA computation to be overridden by system config for customers without
// a contract. Kept as a pure parameter so tests can inject explicit defaults.
export interface SlaDefaults {
  firstResponseMinutes: number;
  resolutionHours: number;
  businessHours: BusinessHours;
}

const HARDCODED_FALLBACK: SlaDefaults = {
  firstResponseMinutes: 60,
  resolutionHours: 8,
  businessHours: {},
};

// Resolve the SLA targets for a ticket given its contract and priority.
// Priority tier overrides base; falls back to the contract's base targets, then
// to the system config defaults (previously hardcoded) for customers without a contract.
export function resolveTargets(
  contract: Contract | null,
  priority: TicketPriority,
  defaults: SlaDefaults = HARDCODED_FALLBACK,
): { firstResponseMinutes: number; resolutionHours: number; businessHours: BusinessHours } {
  if (!contract) {
    return {
      firstResponseMinutes: defaults.firstResponseMinutes,
      resolutionHours: defaults.resolutionHours,
      businessHours: defaults.businessHours,
    };
  }
  const tier = contract.priorityTier?.[priority];
  if (tier) {
    return {
      firstResponseMinutes: tier.first_response_minutes,
      resolutionHours: tier.resolution_hours,
      businessHours: (contract.businessHours as BusinessHours) ?? defaults.businessHours,
    };
  }
  return {
    firstResponseMinutes: contract.slaFirstResponseMinutes,
    resolutionHours: contract.slaResolutionHours,
    businessHours: (contract.businessHours as BusinessHours) ?? defaults.businessHours,
  };
}

// Builds or updates the SLA record for a ticket, computing due dates based on
// business hours. Returns the SLA entity plus a computed status for display.
export function computeSla(
  ticket: Ticket,
  contract: Contract | null,
  now: Date = new Date(),
  defaults: SlaDefaults = HARDCODED_FALLBACK,
): { sla: Sla; status: SlaStatus } {
  const { firstResponseMinutes, resolutionHours, businessHours } = resolveTargets(
    contract,
    ticket.priority,
    defaults,
  );
  const hours: BusinessHours = businessHours ?? {};

  const created = ticket.createdAt ?? now;
  const firstResponseDueAt = addBusinessMinutes(created, firstResponseMinutes, hours);
  const resolutionDueAt = addBusinessMinutes(created, resolutionHours * 60, hours);

  let status: SlaStatus = SlaStatus.VERDE;
  const nowMs = now.getTime();
  if (firstResponseDueAt.getTime() < nowMs || resolutionDueAt.getTime() < nowMs) {
    status = SlaStatus.ROJO;
  } else {
    // Use yellow if within the last 25% of the resolution window.
    const totalWindowMinutes = resolutionHours * 60;
    const timing = classifySla(resolutionDueAt, totalWindowMinutes, now);
    status = timing.status as SlaStatus;
  }

  const sla = new Sla();
  sla.ticketId = ticket.id;
  sla.firstResponseDueAt = firstResponseDueAt;
  sla.resolutionDueAt = resolutionDueAt;
  sla.firstResponseAt = ticket.firstResponseAt ?? null;
  sla.resolvedAt = ticket.resolvedAt ?? null;
  sla.status = status;
  sla.targetFirstResponseMinutes = firstResponseMinutes;
  sla.targetResolutionHours = resolutionHours;

  return { sla, status };
}

@Injectable()
export class SlaService implements OnModuleInit {
  private cachedDefaults: SlaDefaults = HARDCODED_FALLBACK;

  constructor(
    @InjectRepository(SystemSettings) private readonly settings: Repository<SystemSettings>,
  ) {}

  // Load system-config defaults once on boot; updated at runtime via compute()
  // cache refresh (see #refreshDefaults). Keeps SLA consistent without restarts.
  async onModuleInit() {
    this.cachedDefaults = await this.loadDefaults();
  }

  // Treat an empty settings row (no working hours) as 24/7, mirroring hasWorkingHours.
  private async loadDefaults(): Promise<SlaDefaults> {
    try {
      const rows = await this.settings.find();
      const s = rows[0];
      if (!s) return HARDCODED_FALLBACK;
      return {
        firstResponseMinutes: s.slaFirstResponseMinutes,
        resolutionHours: s.slaResolutionHours,
        businessHours: s.businessHours ?? {},
      };
    } catch {
      return HARDCODED_FALLBACK;
    }
  }

  // Public: (re)load config defaults, e.g. after an admin saves settings so the
  // next SLA computation uses the new values in real time.
  async refreshDefaults() {
    this.cachedDefaults = await this.loadDefaults();
  }

  // Recompute & reclassify a ticket's SLA (used on status/priority change).
  // Pure function reused by TicketsService; exposed here for the dashboard.
  compute(ticket: Ticket, contract: Contract | null, now = new Date()) {
    return computeSla(ticket, contract, now, this.cachedDefaults);
  }
}
