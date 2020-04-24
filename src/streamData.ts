import { Packet } from "ts-demuxer";

export { Packet };

export class StreamData {
  public packets: Packet[] = [];
  public byteLength = 0;
  private has_pts = false;
  private first_pts = 0;
  private last_pts = 0;
  private frame_ticks = 0;
  
  get fps(): number { return 90000 / this.frame_ticks; }
  get length(): number {
    return (this.last_pts + this.frame_ticks - this.first_pts) / 90000;
  }

  add(packet: Packet): void {
    this.packets.push(packet);
    this.byteLength += packet.data.byteLength;
    if (!this.has_pts) {
      this.has_pts = true;
      this.first_pts = packet.pts;
    }
    this.last_pts = packet.pts;
    this.frame_ticks = packet.frame_ticks;
  }
}
  