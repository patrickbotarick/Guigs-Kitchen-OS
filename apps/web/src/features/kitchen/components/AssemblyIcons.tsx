import clock from '../../../assets/kitchen/icons/clock.svg';
import pizza from '../../../assets/kitchen/icons/pizza.svg';
import extra from '../../../assets/kitchen/icons/extras.svg';
import check from '../../../assets/kitchen/icons/check.svg';
import checkCircle from '../../../assets/kitchen/icons/check-circle.svg';
import close from '../../../assets/kitchen/icons/remove.svg';
import plus from '../../../assets/kitchen/icons/add.svg';
import play from '../../../assets/kitchen/icons/play.svg';
import flame from '../../../assets/kitchen/icons/fire.svg';
import queue from '../../../assets/kitchen/icons/queue.svg';
import assembly from '../../../assets/kitchen/icons/chef-hat.svg';
import flag from '../../../assets/kitchen/icons/done.svg';
import oven from '../../../assets/kitchen/icons/oven.svg';
import sort from '../../../assets/kitchen/icons/sort.svg';

const assets = { clock, pizza, extra, check, checkCircle, close, plus, play, flame, queue, assembly, flag, oven, sort };
export type IconName = keyof typeof assets;
export function AssemblyIcon({ name }: { name: IconName }) {
  // Isolated image documents prevent Illustrator's repeated IDs/classes from colliding.
  // Multicolor icons retain their official artwork; monochrome assets inherit CSS color via a mask.
  if (['checkCircle', 'close', 'plus'].includes(name)) return <img className="ka-icon ka-icon-color" src={assets[name]} alt="" aria-hidden="true" />;
  return <span className="ka-icon ka-icon-mask" data-icon={name} aria-hidden="true" style={{ maskImage: `url("${assets[name]}")`, WebkitMaskImage: `url("${assets[name]}")` }} />;
}
