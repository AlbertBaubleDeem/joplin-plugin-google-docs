// Minimal type definitions for Joplin note list renderer
// Based on Joplin's internal types

export enum ItemFlow {
  TopToBottom = 'topToBottom',
  LeftToRight = 'leftToRight',
}

export interface Size {
  width: number;
  height: number;
}

export type ListRendererDependency = 
  | 'item.index'
  | 'item.selected'
  | 'item.size.height'
  | 'item.size.width'
  | 'note.id'
  | 'note.parent_id'
  | 'note.title'
  | 'note.is_todo'
  | 'note.todo_completed'
  | 'note.todo_due'
  | 'note.user_updated_time'
  | 'note.user_created_time'
  | 'note.encryption_applied'
  | 'note.is_shared'
  | 'note.deleted_time'
  | 'note.is_conflict'
  | 'note.latitude'
  | 'note.longitude'
  | 'note.altitude'
  | 'note.author'
  | 'note.source_url'
  | 'note.markup_language'
  | 'note.share_id'
  | 'note.conflict_original_id'
  | 'note.master_key_id'
  | 'note.body'
  | 'note.isWatched'
  | 'note.todoStatusText';

export type OnRenderNoteHandler = (props: any) => Promise<any>;

export interface ListRenderer {
  id: string;
  label: () => Promise<string>;
  flow: ItemFlow;
  itemSize: Size;
  dependencies?: ListRendererDependency[];
  itemCss?: string;
  itemTemplate: string;
  onRenderNote: OnRenderNoteHandler;
  multiColumns?: boolean;
}
