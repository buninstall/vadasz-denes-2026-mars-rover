export const generateDummyMap = (size = 50) => {
  const grid: string[][] = [];
  for (let y = 0; y < size; y++) {
    const row: string[] = [];
    for (let x = 0; x < size; x++) {
      if (x === 0 && y === 0) row.push('S');
      else if (Math.random() > 0.95) row.push('#');
      else if (Math.random() > 0.98) row.push('B');
      else if (Math.random() > 0.99) row.push('Y');
      else if (Math.random() > 0.995) row.push('G');
      else row.push('.');
    }
    grid.push(row);
  }
  return { grid };
};

const formatSimTime = (totalHalfHours: number) => {
  const totalMinutes = (0 * 60) + (totalHalfHours * 30);
  const hours = Math.floor(totalMinutes / 60) % 24;
  const minutes = totalMinutes % 60;
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
};
