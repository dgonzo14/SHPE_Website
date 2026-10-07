import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { renderWithProviders } from "@/test/renderWithProviders";
import { ImageField, type ImageFieldProps } from "../ImageField";
import { AVATAR_SPEC, BANNER_SPEC, ImageProcessingError, type ImageCrop } from "../imageUpload";

// Decoding, drawing and encoding need a real canvas, which jsdom lacks; those
// are covered in imageUpload.test.ts. The crop maths and file checks stay real.
const loadImage = vi.fn<(file: File | Blob) => Promise<HTMLImageElement>>();
const renderCroppedImage = vi.fn<(img: HTMLImageElement, spec: unknown, crop: ImageCrop) => Promise<Blob>>();
const drawCropPreview = vi.fn<(canvas: HTMLCanvasElement, img: HTMLImageElement, aspect: number, crop: ImageCrop) => void>();

vi.mock("../imageUpload", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../imageUpload")>()),
  loadImage: (file: File | Blob) => loadImage(file),
  renderCroppedImage: (img: HTMLImageElement, spec: unknown, crop: ImageCrop) =>
    renderCroppedImage(img, spec, crop),
  drawCropPreview: (canvas: HTMLCanvasElement, img: HTMLImageElement, aspect: number, crop: ImageCrop) =>
    drawCropPreview(canvas, img, aspect, crop),
}));

const uploadCardImage = vi.fn<(memberId: string, blob: Blob) => Promise<string>>();
vi.mock("@/services/cards", () => ({
  uploadCardImage: (memberId: string, blob: Blob) => uploadCardImage(memberId, blob),
  cardMediaUrl: (path: string | null) => (path ? `https://cdn.test/card-media/${path}` : null),
}));

const MEMBER = "11111111-1111-4111-8111-111111111111";
const PATH = `${MEMBER}/22222222-2222-4222-8222-222222222222.webp`;
const fakeImage = { naturalWidth: 800, naturalHeight: 600, width: 800, height: 600 } as HTMLImageElement;
const photo = () => new File(["jpeg bytes"], "me.jpg", { type: "image/jpeg" });

function setup(props: Partial<ImageFieldProps> = {}) {
  const onChange = vi.fn();
  const user = userEvent.setup({ applyAccept: false });
  renderWithProviders(
    <ImageField
      label="Photo"
      hint="A square photo works best."
      spec={AVATAR_SPEC}
      value={null}
      onChange={onChange}
      memberId={MEMBER}
      shape="circle"
      {...props}
    />,
    { route: "/portal/card" },
  );
  return { onChange, user };
}

async function chooseFile(user: ReturnType<typeof userEvent.setup>, file = photo()) {
  await user.upload(screen.getByLabelText("Choose a photo file"), file);
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("ImageField", () => {
  it("labels the group and shows an empty state", () => {
    setup();
    const group = screen.getByRole("group", { name: "Photo" });
    expect(group).toHaveAccessibleDescription("A square photo works best.");
    expect(within(group).getByText("No photo yet")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Upload photo" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /remove/i })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Choose a photo file")).toHaveAttribute(
      "accept",
      "image/jpeg,image/png,image/webp,image/gif",
    );
  });

  it("shows the current image from storage, with Replace and Remove", async () => {
    const { onChange, user } = setup({ value: PATH });
    expect(screen.getByRole("img", { name: "Current photo" })).toHaveAttribute(
      "src",
      `https://cdn.test/card-media/${PATH}`,
    );
    expect(screen.getByRole("button", { name: "Replace photo" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Remove photo" }));
    expect(onChange).toHaveBeenCalledWith(null);
    expect(screen.getByRole("status")).toHaveTextContent("Photo removed");
  });

  it("moves focus to Upload when Remove takes itself away", async () => {
    // Stateful, as in the editor: the form's value really does become null.
    function Stateful() {
      const [value, setValue] = useState<string | null>(PATH);
      return (
        <ImageField label="Photo" spec={AVATAR_SPEC} value={value} onChange={setValue} memberId={MEMBER} shape="circle" />
      );
    }
    const user = userEvent.setup();
    renderWithProviders(<Stateful />, { route: "/portal/card" });

    await user.click(screen.getByRole("button", { name: "Remove photo" }));

    expect(screen.queryByRole("button", { name: "Remove photo" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Upload photo" })).toHaveFocus();
    expect(document.activeElement).not.toBe(document.body);
  });

  it("does the same from the keyboard", async () => {
    function Stateful() {
      const [value, setValue] = useState<string | null>(PATH);
      return <ImageField label="Banner" spec={BANNER_SPEC} value={value} onChange={setValue} memberId={MEMBER} />;
    }
    const user = userEvent.setup();
    renderWithProviders(<Stateful />, { route: "/portal/card" });

    screen.getByRole("button", { name: "Remove banner" }).focus();
    await user.keyboard("{Enter}");

    expect(screen.getByRole("button", { name: "Upload banner" })).toHaveFocus();
  });

  it("falls back to the placeholder when the stored image won't load", () => {
    setup({ value: PATH });
    fireEvent.error(screen.getByRole("img", { name: "Current photo" }));
    expect(screen.getByText("Your photo couldn't be shown")).toBeInTheDocument();
  });

  it("opens the Upload button's file picker", async () => {
    const { user } = setup();
    const input = screen.getByLabelText<HTMLInputElement>("Choose a photo file");
    const click = vi.spyOn(input, "click");
    await user.click(screen.getByRole("button", { name: "Upload photo" }));
    expect(click).toHaveBeenCalled();
  });

  it("crops, uploads and hands the new path to the form", async () => {
    loadImage.mockResolvedValue(fakeImage);
    const blob = new Blob(["webp"], { type: "image/webp" });
    renderCroppedImage.mockResolvedValue(blob);
    uploadCardImage.mockResolvedValue(PATH);
    const { onChange, user } = setup();

    await chooseFile(user);
    const dialog = await screen.findByRole("dialog", { name: "Position your photo" });
    expect(drawCropPreview).toHaveBeenLastCalledWith(
      expect.any(HTMLCanvasElement),
      fakeImage,
      1,
      { zoom: 1, x: 0, y: 0 },
    );

    // A landscape photo in a square frame can move sideways at once, but not
    // up and down until it's zoomed.
    const zoom = within(dialog).getByRole("slider", { name: "Zoom" });
    const horizontal = within(dialog).getByRole("slider", { name: "Left and right" });
    const vertical = within(dialog).getByRole("slider", { name: "Up and down" });
    expect(horizontal).toBeEnabled();
    expect(vertical).toBeDisabled();
    expect(within(dialog).getByText(/zoom in to move the picture up and down/i)).toBeInTheDocument();

    fireEvent.change(zoom, { target: { value: "2" } });
    expect(zoom).toHaveAttribute("aria-valuetext", "200%");
    expect(vertical).toBeEnabled();
    fireEvent.change(horizontal, { target: { value: "-1" } });
    fireEvent.change(vertical, { target: { value: "0.5" } });
    expect(horizontal).toHaveAttribute("aria-valuetext", "100% toward the left");
    expect(vertical).toHaveAttribute("aria-valuetext", "50% toward the bottom");
    expect(drawCropPreview).toHaveBeenLastCalledWith(expect.any(HTMLCanvasElement), fakeImage, 1, {
      zoom: 2,
      x: -1,
      y: 0.5,
    });

    await user.click(within(dialog).getByRole("button", { name: "Use this photo" }));

    await waitFor(() => expect(onChange).toHaveBeenCalledWith(PATH));
    expect(renderCroppedImage).toHaveBeenCalledWith(fakeImage, AVATAR_SPEC, { zoom: 2, x: -1, y: 0.5 });
    expect(uploadCardImage).toHaveBeenCalledWith(MEMBER, blob);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("New photo added. Save your card to publish it.");
  });

  it("pans when the preview is dragged", async () => {
    loadImage.mockResolvedValue(fakeImage);
    const { user } = setup();
    await chooseFile(user);
    const dialog = await screen.findByRole("dialog");

    fireEvent.change(within(dialog).getByRole("slider", { name: "Zoom" }), { target: { value: "2" } });
    const canvas = within(dialog).getByRole("img", { name: /preview of your photo/i });
    vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue({
      width: 300,
      height: 300,
      top: 0,
      left: 0,
      right: 300,
      bottom: 300,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });

    // 300 source px fill 300 screen px; the 500 px of overflow spans −1..1, so
    // dragging 50 px right shows 50 px more of the left: x = −0.2.
    fireEvent.pointerDown(canvas, { pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 150, clientY: 100 });
    fireEvent.pointerUp(canvas, { pointerId: 1 });
    fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 400, clientY: 100 });

    expect(within(dialog).getByRole("slider", { name: "Left and right" })).toHaveValue("-0.2");
  });

  it("explains a file it can't use, without opening the dialog", async () => {
    const { user } = setup();
    await chooseFile(user, new File(["<svg/>"], "logo.svg", { type: "image/svg+xml" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Choose a JPEG, PNG, WebP or GIF image.");
    expect(loadImage).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("explains an image that won't decode", async () => {
    loadImage.mockRejectedValue(new ImageProcessingError("We couldn't read that image. Try a different one."));
    const { user } = setup();
    await chooseFile(user);
    expect(await screen.findByRole("alert")).toHaveTextContent("We couldn't read that image");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("keeps the dialog open with a readable error when the upload fails", async () => {
    loadImage.mockResolvedValue(fakeImage);
    renderCroppedImage.mockResolvedValue(new Blob(["webp"], { type: "image/webp" }));
    uploadCardImage.mockRejectedValueOnce({ message: "new row violates row-level security policy" });
    uploadCardImage.mockResolvedValueOnce(PATH);
    const { onChange, user } = setup();

    await chooseFile(user);
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Use this photo" }));

    // A storage-policy refusal is the 30-image cap or a suspended membership,
    // not a role problem, and the message says so.
    const alert = await within(dialog).findByRole("alert");
    expect(alert).toHaveTextContent("You can keep up to 30 card images");
    expect(alert).not.toHaveTextContent("check your role");
    expect(onChange).not.toHaveBeenCalled();

    // And trying again works.
    await user.click(within(dialog).getByRole("button", { name: "Use this photo" }));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(PATH));
  });

  it("treats a 403 from storage as the same refusal, and other failures generically", async () => {
    loadImage.mockResolvedValue(fakeImage);
    renderCroppedImage.mockResolvedValue(new Blob(["webp"], { type: "image/webp" }));
    uploadCardImage.mockRejectedValueOnce({ statusCode: "403", message: "Unauthorized" });
    uploadCardImage.mockRejectedValueOnce({ statusCode: "500", message: "Internal error" });
    const { user } = setup();

    await chooseFile(user);
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Use this photo" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("You can keep up to 30 card images");

    await user.click(within(dialog).getByRole("button", { name: "Use this photo" }));
    await waitFor(() =>
      expect(within(dialog).getByRole("alert")).toHaveTextContent("We couldn't upload that image"),
    );
  });

  it("shows image-processing errors as written", async () => {
    loadImage.mockResolvedValue(fakeImage);
    renderCroppedImage.mockRejectedValue(
      new ImageProcessingError("We couldn't make that image small enough to upload. Try a different photo."),
    );
    const { user } = setup();
    await chooseFile(user);
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Use this photo" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("small enough to upload");
    expect(uploadCardImage).not.toHaveBeenCalled();
  });

  it("can't be dismissed mid-upload", async () => {
    loadImage.mockResolvedValue(fakeImage);
    renderCroppedImage.mockResolvedValue(new Blob(["webp"], { type: "image/webp" }));
    const upload = deferred<string>();
    uploadCardImage.mockReturnValue(upload.promise);
    const { onChange, user } = setup();

    await chooseFile(user);
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Use this photo" }));

    expect(await within(dialog).findByRole("button", { name: /uploading/i })).toBeDisabled();
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toBeDisabled();
    expect(within(dialog).getByRole("slider", { name: "Zoom" })).toBeDisabled();
    await user.keyboard("{Escape}");
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    upload.resolve(PATH);
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(PATH));
  });

  it("cancels without uploading, and lets the same file be chosen again", async () => {
    loadImage.mockResolvedValue(fakeImage);
    const { onChange, user } = setup();

    await chooseFile(user);
    const dialog = await screen.findByRole("dialog");
    expect(screen.getByLabelText<HTMLInputElement>("Choose a photo file").value).toBe("");
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(renderCroppedImage).not.toHaveBeenCalled();
    expect(uploadCardImage).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();

    await chooseFile(user);
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(loadImage).toHaveBeenCalledTimes(2);
  });

  it("frames a banner at its own aspect, with a rectangular preview", async () => {
    loadImage.mockResolvedValue(fakeImage);
    const { user } = setup({ label: "Banner", spec: BANNER_SPEC, shape: "rect" });
    await user.upload(screen.getByLabelText("Choose a banner file"), photo());
    const dialog = await screen.findByRole("dialog", { name: "Position your banner" });
    const canvas = within(dialog).getByRole("img", { name: /preview of your banner/i });
    expect(canvas).toHaveAttribute("width", "720");
    expect(canvas).toHaveAttribute("height", "240");
    expect(drawCropPreview).toHaveBeenLastCalledWith(canvas, fakeImage, 3, { zoom: 1, x: 0, y: 0 });
    // An 800×600 photo in a 3:1 frame has room to move up and down only.
    expect(within(dialog).getByRole("slider", { name: "Up and down" })).toBeEnabled();
    expect(within(dialog).getByRole("slider", { name: "Left and right" })).toBeDisabled();
  });
});
