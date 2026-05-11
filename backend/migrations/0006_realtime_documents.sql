alter type notification_type add value if not exists 'document_updated';

alter table documents
  add column crdt_state text;
