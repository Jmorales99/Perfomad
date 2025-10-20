import type { FastifyInstance } from 'fastify';
import { supabase } from '../../../infrastructure/db/supabaseClient.js';

export async function widgetRoutes(app: FastifyInstance) {
  // Crear un widget
  app.post('/', async (req, reply) => {
    const body = req.body as { name?: string };

    if (!body?.name) {
      return reply.code(400).send({ error: 'Name is required' });
    }

    const { data, error } = await supabase
      .from('widgets')
      .insert({ name: body.name })
      .select()
      .single();

    if (error) {
      req.log.error(error);
      return reply.code(500).send({ error: 'Error creating widget' });
    }

    return reply.code(201).send(data);
  });

  // Obtener todos los widgets
  app.get('/', async () => {
    const { data, error } = await supabase.from('widgets').select('*').order('created_at', { ascending: false });

    if (error) throw error;

    return data;
  });
}
