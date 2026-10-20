import AccessibleDialog from './AccessibleDialog';

interface PhotoPreviewDialogProps {
  src: string;
  name: string;
  onClose: () => void;
}

export default function PhotoPreviewDialog({ src, name, onClose }: PhotoPreviewDialogProps) {
  return (
    <AccessibleDialog
      label={`Photo agrandie de ${name}`}
      onClose={onClose}
      overlayClassName="modal-overlay open photo-preview-overlay"
      panelClassName="photo-preview-panel"
    >
      <figure className="photo-preview-frame">
        <div className="photo-preview-mat">
          <img src={src} alt={name} className="photo-preview-image" />
        </div>
        <figcaption className="photo-preview-caption">
          <strong>{name}</strong>
          <span>Portrait du sénateur</span>
        </figcaption>
      </figure>
    </AccessibleDialog>
  );
}
