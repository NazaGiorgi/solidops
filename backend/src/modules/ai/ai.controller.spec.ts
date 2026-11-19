import { ConfigService } from '@nestjs/config';
import { NotFoundException } from '@nestjs/common';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';

describe('AiController flags', () => {
  function build(labEnabled: boolean) {
    const ai = { features: jest.fn(() => ({ aiEnabled: true, aiLabEnabled: labEnabled })) };
    const config = { get: jest.fn((key: string) => (key === 'ai.labEnabled' ? labEnabled : undefined)) };
    const controller = new AiController(
      ai as unknown as AiService,
      config as unknown as ConfigService,
    );
    return { controller, ai };
  }

  it('/features responde siempre (para que el front oculte el menú)', () => {
    const { controller } = build(false);
    expect(controller.features()).toEqual({ aiEnabled: true, aiLabEnabled: false });
  });

  it('con AI_LAB_ENABLED=false, health y laboratorio son 404', () => {
    const { controller } = build(false);
    expect(() => controller.health()).toThrow(NotFoundException);
    expect(() => controller.chat({ prompt: 'hola' }, {} as never)).toThrow(NotFoundException);
  });

  it('con AI_LAB_ENABLED=true, llama al servicio', () => {
    const { controller, ai } = build(true);
    (ai as unknown as Record<string, jest.Mock>).health = jest.fn();
    (ai as unknown as Record<string, jest.Mock>).chat = jest.fn();
    expect(() => controller.health()).not.toThrow();
    expect(() => controller.chat({ prompt: 'hola' }, {} as never)).not.toThrow();
  });
});
